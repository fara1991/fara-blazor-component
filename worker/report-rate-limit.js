// 報告の受け口（report.js）の 1 日の送信回数の制限（kit の共有ファイル。各サイトは submodule で読む）。
//
// 使い方（サイトの worker/index.js）:
//   export { ReportRateLimiter } from "../external/fara-site-kit/worker/report-rate-limit.js";
// そして wrangler の設定に、バインディング REPORT_LIMITER（class_name は ReportRateLimiter）と migrations を書く（docs/usage.md の 2.2）。
// バインディングが無いサイトでは、この制限は働かない（従来どおり）。
//
// 保存するもの: 送信元の識別子（秘密鍵つきの HMAC-SHA256 の先頭 128 ビット。鍵は Turnstile の秘密鍵から用途ラベル付きで導く）と、その日の回数。
// IP そのものは保存しない。日付（JST の暦日）ごとにキーを分ける。
// 保存期間: 日付が変わった後、次の掃除（JST の 0 時の alarm。取りこぼしても、次の日の最初のリクエストで掃除する）まで。
// 日付の区切り: 利用者は日本なので、JST の暦日で数える（UTC+9・夏時間なし）。

/** 1 日に送れる回数（送信元ごと）。Turnstile を通ったあとの送信の試み（Discord へ送る前に数え、送信が失敗したら戻す）。 */
export const REPORT_DAILY_LIMIT = 3;
/** 鍵の導出に使うラベル（秘密ではない。鍵そのものは Turnstile の秘密鍵から作る）。 */
export const KEY_LABEL = "fara-site-kit/report-limit/v1";
/** DO の固定名（インスタンスは 1 つ。名前に IP などは入れない）。 */
export const LIMITER_NAME = "report-rate-limit";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_DELETE_CHUNK = 128;
const META_SWEPT_DAY = "meta:swept-day";
const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}:[0-9a-f]{32}$/;

/**
 * JST の暦日（YYYY-MM-DD）。
 * @param {Date} now
 * @returns {string}
 */
export function jstDay(now) {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 次の JST の 0 時（UTC の Date）。
 * @param {Date} now
 * @returns {Date}
 */
export function nextJstMidnight(now) {
  const jstNow = now.getTime() + JST_OFFSET_MS;
  const nextJstStart = (Math.floor(jstNow / DAY_MS) + 1) * DAY_MS;
  return new Date(nextJstStart - JST_OFFSET_MS);
}

/**
 * 次の JST の 0 時までの秒（切り上げ・最小 1）。Retry-After に使う。
 * @param {Date} now
 * @returns {number}
 */
export function secondsUntilNextJstMidnight(now) {
  return Math.max(1, Math.ceil((nextJstMidnight(now).getTime() - now.getTime()) / 1000));
}

const enc = new TextEncoder();
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * 送信元の識別子（16 バイト・32 桁の hex）。秘密鍵つきなので、秘密鍵が無いと同じ値を作れない（IPv4 の全探索で逆算できない）。
 * 鍵は HMAC(秘密鍵, KEY_LABEL) で導く（用途を分けるため）。秘密鍵を変えると、すべての識別子が変わる（計数はリセットされる）。
 * @param {string} secret 秘密鍵（Turnstile の秘密鍵 TURNSTILE_SECRET）
 * @param {string} ip CF-Connecting-IP の値
 * @param {string} day jstDay の値（日付が変わると、同じ IP でも別の値になる）
 * @returns {Promise<string>}
 */
export async function clientHash(secret, ip, day) {
  const master = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const derivedBytes = new Uint8Array(await crypto.subtle.sign("HMAC", master, enc.encode(KEY_LABEL)));
  const key = await crypto.subtle.importKey("raw", derivedBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${ip}\n${day}`)));
  return toHex(mac.slice(0, 16));
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HASH_PATTERN = /^[0-9a-f]{32}$/;

/**
 * 送信元ごと・日ごとの回数を数える Durable Object（旧形式の素のクラス。cloudflare:workers を import しない）。
 *
 * POST /hit     ← {"day", "hash", "limit"}  → 200 {"allowed": true, "count": n}（数えた）／ {"allowed": false, "count": n}（上限。増やさない）
 * POST /release ← {"day", "hash"}           → 200 {"released": bool, "count": n}（Discord への送信が失敗したときに 1 つ戻す）
 * 形が正しくないときは 400、他のパスは 404、POST 以外は 405。
 *
 * 並行性: 判定と加算（release は減算）は storage.transaction() の中で行う。公式 docs（Storage API）では、transaction() は複数の storage 操作を
 * 1 つの単位としてコミットまたは中止する（KV・SQLite の両方で使える。SQLite 版では closure の中で ctx.storage を直接使う）。
 * input gate（storage 操作の間に他のイベントを入れない仕組み）の挙動は、確認した公式 docs のページに記載が見つからなかったため、要照合。
 */
export class ReportRateLimiter {
  /**
   * @param {{ storage: any }} state Durable Object の state（storage を使う）
   * @param {unknown} _env 未使用（この制限は環境の値を読まない）
   */
  constructor(state, _env) {
    this.storage = state.storage;
  }

  /** @param {Request} request */
  async fetch(request) {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    const path = new URL(request.url).pathname;
    if (path !== "/hit" && path !== "/release") return json(404, { error: "not_found" });
    let body;
    try { body = await request.json(); } catch { return json(400, { error: "invalid_json" }); }
    if (body === null || typeof body !== "object") return json(400, { error: "invalid_body" });
    const { day, hash, limit } = body;
    if (typeof day !== "string" || !DAY_PATTERN.test(day)) return json(400, { error: "invalid_day" });
    if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) return json(400, { error: "invalid_hash" });
    const key = `${day}:${hash}`;

    if (path === "/release") {
      const result = await this.storage.transaction(async () => {
        const count = (await this.storage.get(key)) ?? 0;
        if (count <= 0) return { released: false, count: 0 };
        if (count === 1) await this.storage.delete(key);
        else await this.storage.put(key, count - 1);
        return { released: true, count: count - 1 };
      });
      return json(200, result);
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return json(400, { error: "invalid_limit" });
    const now = new Date();
    await this.sweepIfNewDay(now);
    const result = await this.storage.transaction(async () => {
      const count = (await this.storage.get(key)) ?? 0;
      if (count >= limit) return { allowed: false, count };
      await this.storage.put(key, count + 1);
      return { allowed: true, count: count + 1 };
    });
    // 掃除の予約が無ければ入れる（次の JST 0 時）
    if ((await this.storage.getAlarm()) === null) await this.storage.setAlarm(nextJstMidnight(now).getTime());
    return json(200, result);
  }

  /** 日が変わっていて、まだ掃除していなければ掃除する（alarm の取りこぼしの保険）。 */
  async sweepIfNewDay(now) {
    const today = jstDay(now);
    if ((await this.storage.get(META_SWEPT_DAY)) === today) return;
    await this.sweep(today);
    await this.storage.put(META_SWEPT_DAY, today);
  }

  /**
   * 今日より前の日のキーをすべて消す（キーの形が合うものだけ）。
   * 規模: storage.list() は、この DO が保存しているキー（1 日の送信元の数 × 日数。1 日分は、その日に送った IP の数）を一度に読む。
   */
  async sweep(today) {
    const entries = await this.storage.list();
    const stale = [];
    for (const key of entries.keys()) {
      if (KEY_PATTERN.test(key) && key.slice(0, 10) < today) stale.push(key);
    }
    for (let i = 0; i < stale.length; i += STORAGE_DELETE_CHUNK) {
      await this.storage.delete(stale.slice(i, i + STORAGE_DELETE_CHUNK));
    }
  }

  /** JST の 0 時に呼ばれる。掃除し、掃除が失敗しても、次の 0 時の予約は入れる（try/finally）。 */
  async alarm() {
    try {
      const today = jstDay(new Date());
      await this.sweep(today);
      await this.storage.put(META_SWEPT_DAY, today);
    } finally {
      await this.storage.setAlarm(nextJstMidnight(new Date()).getTime());
    }
  }
}

/**
 * 送信の回数を 1 回数える（上限に達していれば拒否）。
 * 戻り値: { allowed }。例外（DO が使えない・応答が読めない）は呼び出し側で扱う（report.js は fail-open）。
 * @param {{ idFromName: (name: string) => unknown, get: (id: unknown) => { fetch: (url: string, init: object) => Promise<Response> } }} namespace
 * @param {{ day: string, hash: string, limit?: number }} input
 */
export async function hitReportLimiter(namespace, { day, hash, limit = REPORT_DAILY_LIMIT }) {
  const result = await callLimiter(namespace, "/hit", { day, hash, limit });
  if (typeof result.allowed !== "boolean") throw new Error("report rate limiter response unusable");
  return { allowed: result.allowed };
}

/**
 * 数えた 1 回を戻す（Discord への送信が失敗したとき）。例外は呼び出し側で扱う（報告の応答は変えない）。
 * @param {Parameters<typeof hitReportLimiter>[0]} namespace
 * @param {{ day: string, hash: string }} input
 */
export async function releaseReportLimiter(namespace, { day, hash }) {
  await callLimiter(namespace, "/release", { day, hash });
}

async function callLimiter(namespace, path, body) {
  const stub = namespace.get(namespace.idFromName(LIMITER_NAME));
  const res = await stub.fetch(`https://report-rate-limit${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`report rate limiter ${path} status ${res.status}`);
  const result = await res.json();
  if (result === null || typeof result !== "object") throw new Error("report rate limiter response unusable");
  return result;
}
