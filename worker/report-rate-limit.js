// 報告の受け口（report.js）の 1 日の送信回数の制限（kit の共有ファイル。各サイトは submodule で読む）。
//
// 使い方（サイトの worker/index.js）:
//   export { ReportRateLimiter } from "../external/fara-site-kit/worker/report-rate-limit.js";
// そして wrangler の設定に、バインディング REPORT_LIMITER（class_name は ReportRateLimiter）と migrations を書く（docs/usage.md の 2.2）。
// バインディングが無いサイトでは、この制限は働かない（従来どおり）。
//
// 保存するもの: 送信元の短縮ハッシュ（SHA-256(IP + 用途ソルト + 日付) の先頭 128 ビット）と、その日の回数だけ。IP そのものは保存しない。
// 保存期間: 日付（JST の暦日）ごとのキー。JST の次の 0 時に alarm で、前の日のキーをすべて消す（最長でも、その日が終わってから数分）。
// 日付の区切り: 利用者は日本なので、JST の暦日で数える（UTC+9・夏時間なし）。

/** 1 日に送れる回数（送信元ごと）。Turnstile を通ったあとの送信の試み（Discord へ送る前）を数える。 */
export const REPORT_DAILY_LIMIT = 3;
/** 送信元の識別子を作るときの用途の文字列（秘密ではない。同じ IP でも、用途が違えば別のハッシュになる）。 */
export const HASH_PURPOSE = "fara-site-kit:report-daily-limit:v1";
/** DO の固定名（インスタンスは 1 つ。名前に IP などは入れない）。 */
export const LIMITER_NAME = "report-rate-limit";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_DELETE_CHUNK = 128;

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

/**
 * 送信元の短縮ハッシュ（16 バイト・32 桁の hex）。IP の代わりに保存・送信するのは、この値だけ。
 * @param {string} ip CF-Connecting-IP の値
 * @param {string} day jstDay の値（日付が変わると、同じ IP でも別の値になる）
 * @returns {Promise<string>}
 */
export async function clientHash(ip, day) {
  const bytes = new TextEncoder().encode(`${ip}\n${HASH_PURPOSE}\n${day}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HASH_PATTERN = /^[0-9a-f]{32}$/;

/**
 * 送信元ごと・日ごとの回数を数える Durable Object（旧形式の素のクラス。cloudflare:workers を import しない）。
 *
 * POST（任意のパス）← {"day": "YYYY-MM-DD", "hash": "32 桁の hex", "limit": 整数}
 *   → 200 {"allowed": true, "count": n}（数えた）／ {"allowed": false, "count": n}（上限に達しているので増やさない）
 *   → 400 形が正しくないとき
 *
 * 判定と加算は、storage の get → put の間に外への await を挟まない（同時に来た回も、上限を超えない）。
 */
export class ReportRateLimiter {
  /**
   * @param {{ storage: any }} state Durable Object の state（storage を使う）
   * @param {unknown} _env 未使用（DO のバインディングの環境。この制限では読まない）
   */
  constructor(state, _env) {
    this.storage = state.storage;
  }

  /** @param {Request} request */
  async fetch(request) {
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    let body;
    try { body = await request.json(); } catch { return json(400, { error: "invalid_json" }); }
    if (body === null || typeof body !== "object") return json(400, { error: "invalid_body" });
    const { day, hash, limit } = body;
    if (typeof day !== "string" || !DAY_PATTERN.test(day)) return json(400, { error: "invalid_day" });
    if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) return json(400, { error: "invalid_hash" });
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) return json(400, { error: "invalid_limit" });

    const key = `${day}:${hash}`;
    const count = (await this.storage.get(key)) ?? 0;
    if (count >= limit) return json(200, { allowed: false, count });
    await this.storage.put(key, count + 1);
    // 消す予定（alarm）が無ければ入れる。次の JST 0 時に、前の日のキーを消す
    if ((await this.storage.getAlarm()) === null) await this.storage.setAlarm(nextJstMidnight(new Date()).getTime());
    return json(200, { allowed: true, count: count + 1 });
  }

  /** JST の 0 時に呼ばれる。今日より前の日のキーを消す。まだ残りがあれば、次の 0 時に予約し直す。 */
  async alarm() {
    const today = jstDay(new Date());
    const entries = await this.storage.list();
    const stale = [];
    for (const key of entries.keys()) {
      if (key.slice(0, 10) < today) stale.push(key);
    }
    for (let i = 0; i < stale.length; i += STORAGE_DELETE_CHUNK) {
      await this.storage.delete(stale.slice(i, i + STORAGE_DELETE_CHUNK));
    }
    if (entries.size > stale.length) await this.storage.setAlarm(nextJstMidnight(new Date()).getTime());
  }
}

/**
 * 送信の回数を 1 回数える（上限に達していれば拒否）。
 * 戻り値: { allowed: true } ・ { allowed: false } ・ 例外（DO が使えない）。例外の扱いは呼び出し側（report.js は fail-open）。
 * @param {{ idFromName: (name: string) => unknown, get: (id: unknown) => { fetch: (url: string, init: object) => Promise<Response> } }} namespace
 * @param {{ day: string, hash: string, limit?: number }} input
 */
export async function hitReportLimiter(namespace, { day, hash, limit = REPORT_DAILY_LIMIT }) {
  const stub = namespace.get(namespace.idFromName(LIMITER_NAME));
  const res = await stub.fetch("https://report-rate-limit/hit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ day, hash, limit }),
  });
  if (!res.ok) throw new Error(`report rate limiter status ${res.status}`);
  const result = await res.json();
  if (result === null || typeof result !== "object" || typeof result.allowed !== "boolean") throw new Error("report rate limiter response unusable");
  return { allowed: result.allowed };
}
