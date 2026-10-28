// 作者への報告の受け口（POST /api/report）。fara-site-kit の共有ファイル（各サイトは submodule で読む。直すときは kit で直す）。
//
//   GET  /api/report/config → 200 {"enabled": bool, "siteKey": "Turnstile のサイトキー" | null}
//   POST /api/report        ← {"category": "bug" | "request" | "other", "message": "...", "contact"?: "...", "page"?: "...", "turnstileToken": "...", "website": ""}
//                           → 200 {"ok": true} / 400 / 403 / 413 / 415 / 502 / 503
//
// 流れ: 同じサイトのページからか確認 → 本文の検証（長さ・種類） → Turnstile（Cloudflare のボット判定）の確認 → Discord の Webhook に送る。
// 設定（Cloudflare のダッシュボードの Worker の「変数とシークレット」。docs/report-and-maintenance.md）:
//   TURNSTILE_SITE_KEY   サイトキー（公開してよい。変数）
//   TURNSTILE_SECRET     シークレットキー（シークレット）
//   DISCORD_WEBHOOK_URL  通知を送る Discord の Webhook の URL（シークレット）
// どれかが無いときは 503 を返す（報告ページには「いまは受け付けていません」と出る）。
// シークレットと Webhook の URL は、ログ・エラーメッセージ・応答に出さない。サーバー側のログ（console.error）は、Turnstile を使えないとき
// （siteverify の非 2xx・結果を読めない・シークレット不正）と、Discord への送信の失敗の、固定の文と状態コード・error-codes だけ。
// Turnstile 側の問題（利用者の失敗ではない）は 503（いまは受け付けていません）にして、ログに残す。トークンの不正・期限切れは従来どおり 400。
// 報告の本文は個人情報になりうるので、保存しない（Discord に送るだけ）。

import { cleanText as clean } from "./text.js";

/**
 * 本文のバイト数の上限（Content-Length の宣言も、実際に読んだ量も）。32 KB。
 * JSON が非 ASCII を \uXXXX（6 文字。絵文字は 12 文字）にする送り手でも通る大きさ:
 * メッセージ 2000 文字×12 + 連絡先 200 文字×12 + トークン 2048 + ページ 300 + 余白 ≒ 29 KB。（文字数は、バイト数より大きくならないので別には数えない。）
 */
const MAX_BODY_BYTES = 32 * 1024;
/** 外へ出る通信（Turnstile・Discord）を待つ最大の時間。 */
const FETCH_TIMEOUT_MS = 5000;
const MAX_MESSAGE = 2000;
const MAX_CONTACT = 200;
const MAX_PAGE = 300;
const MIN_MESSAGE = 5;
/** 報告のきっかけのページ（先頭の / を含めて 300 文字まで）。 */
const PAGE_PATTERN = new RegExp("^/[A-Za-z0-9\\-_/.]{0," + (MAX_PAGE - 1) + "}$");
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** siteverify が返す error-codes のうち、利用者ではなくこちらの設定・Turnstile 側の問題を示すもの（400 にしない）。 */
const TURNSTILE_SERVER_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "internal-error"]);
const TURNSTILE_FAILED_MESSAGE = "「ロボットではありません」の確認に失敗しました。もう一度お試しください";
const CATEGORIES = { bug: "不具合", request: "要望・提案", other: "その他" };

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });

/** 文字列の整え方（制御文字・対になっていないサロゲートを取り、長さを文字数で切る）。maintenance.js と共有する（text.js）。 */
export { clean };

/** 報告のきっかけのページ（パスだけ）。フッターのリンク・report.js と同じ条件。そうでなければ空。 */
export function cleanPage(value) {
  return typeof value === "string" && PAGE_PATTERN.test(value) && !value.startsWith("//") ? value : "";
}

/**
 * 本文を最大 MAX_BODY_BYTES バイトまで読む。超えたら読むのをやめて null（Content-Length が無い・うそでも、全部は読まない）。
 * @returns {Promise<string | null>}
 */
async function readLimitedText(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Origin ヘッダーのホスト。読めないもの（"null" など）は null。 */
function originHost(origin) {
  try { return new URL(origin).host; } catch { return null; }
}

/** Turnstile を使えないとき（利用者の失敗ではない）。ログに残して 503。reason に秘密は入れない。 */
function turnstileUnavailable(reason) {
  console.error("report: turnstile unavailable:", reason);
  return json(503, { error: "verify_unavailable", message: "いまは報告を受け付けていません" });
}

/** 報告の受け口が使える設定か（3 つの値がそろっているか）。 */
export function isConfigured(env) {
  return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET && env.DISCORD_WEBHOOK_URL);
}

/**
 * /api/report と /api/report/config を処理する。
 * @param {Request} request
 * @param {Record<string, string | undefined>} env
 * @param {string} siteName 通知に出すサイト名
 * @param {{ fetch?: typeof fetch, now?: () => Date }} [deps] テスト用の差し替え
 */
export async function handleReport(request, env, siteName, deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const url = new URL(request.url);

  if (url.pathname === "/api/report/config") {
    if (request.method !== "GET") return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
    // サイトキーは公開してよい値。未設定のときは null（ページ側が「受け付けていません」と出す）
    return json(200, { enabled: isConfigured(env), siteKey: env.TURNSTILE_SITE_KEY || null });
  }
  if (url.pathname !== "/api/report") return json(404, { error: "not_found" });
  if (request.method !== "POST") return json(405, { error: "method_not_allowed" }, { Allow: "POST" });

  // 別のサイトのページから送られないように、同じホストのページからだけ受け付ける
  const origin = request.headers.get("Origin");
  if (!origin || originHost(origin) !== url.host) return json(403, { error: "forbidden" });
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { error: "unsupported_media_type" });

  // 大きな本文は、読み込む前に断る。宣言が無い・うそのときも、読みながらバイト数を数えて、超えたらそこでやめる
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(413, { error: "too_large" });
  const text = await readLimitedText(request);
  if (text === null) return json(413, { error: "too_large" });
  let body;
  try { body = JSON.parse(text); } catch { return json(400, { error: "invalid_json", message: "送信内容を読めませんでした" }); }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "invalid_body", message: "送信内容を読めませんでした" });

  // ボット対策の罠（人には見えない欄）。入っていたら、何も送らずに成功したように返す
  if (typeof body.website === "string" && body.website.length > 0) return json(200, { ok: true });

  const category = typeof body.category === "string" && Object.hasOwn(CATEGORIES, body.category) ? body.category : null;
  if (!category) return json(400, { error: "invalid_category", message: "種類を選んでください" });
  const message = clean(body.message, MAX_MESSAGE);
  if (Array.from(message).length < MIN_MESSAGE) return json(400, { error: "invalid_message", message: `内容を ${MIN_MESSAGE} 文字以上で書いてください` });
  const contact = clean(body.contact, MAX_CONTACT);
  const page = cleanPage(body.page);
  const token = typeof body.turnstileToken === "string" ? body.turnstileToken.slice(0, 2048) : "";
  if (!token) return json(400, { error: "missing_token", message: "「ロボットではありません」の確認をしてください" });

  if (!isConfigured(env)) return json(503, { error: "not_configured", message: "いまは報告を受け付けていません" });

  // Turnstile（ボット判定）
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  let result;
  try {
    const res = await doFetch(TURNSTILE_URL, { method: "POST", body: form, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    // 2xx 以外は、利用者の失敗ではなく Turnstile 側（またはこちらの設定）の問題
    if (!res.ok) return turnstileUnavailable(`siteverify status ${res.status}`);
    try { result = await res.json(); } catch { return turnstileUnavailable("siteverify response unreadable"); }
  } catch (error) {
    console.error("report: turnstile siteverify request failed", error?.name ?? "error");
    return json(502, { error: "verify_failed", message: "確認に失敗しました。もう一度お試しください" });
  }
  if (result === null || typeof result !== "object" || typeof result.success !== "boolean") return turnstileUnavailable("siteverify result unusable");
  if (result.success !== true) {
    const codes = Array.isArray(result["error-codes"]) ? result["error-codes"].filter((c) => typeof c === "string") : [];
    // シークレットの不正など、こちらの設定の問題。トークンの不正・期限切れ（timeout-or-duplicate・invalid-input-response）は利用者の失敗で 400
    if (codes.some((code) => TURNSTILE_SERVER_ERRORS.has(code))) return turnstileUnavailable(`siteverify error-codes ${codes.join(",")}`);
    return json(400, { error: "turnstile_failed", message: TURNSTILE_FAILED_MESSAGE });
  }
  // 確認が通ったページが、いま送っているこのサイトのものか（別のサイトで取ったトークンを使い回されないように）。hostname が無いときも失敗扱い
  if (result.hostname !== url.hostname) return json(400, { error: "turnstile_failed", message: TURNSTILE_FAILED_MESSAGE });

  // Discord へ。@everyone などのメンションは無効にする
  const fields = [{ name: "種類", value: CATEGORIES[category], inline: true }];
  if (contact) fields.push({ name: "連絡先", value: contact, inline: true });
  if (page) fields.push({ name: "ページ", value: page });
  const country = request.cf?.country;
  if (country) fields.push({ name: "国", value: String(country), inline: true });
  const payload = {
    username: "サイトからの報告",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: `${siteName} への報告`,
      description: message,
      color: category === "bug" ? 0xdc3545 : category === "request" ? 0x7c3aed : 0x6b5f8a,
      fields,
      timestamp: (deps.now?.() ?? new Date()).toISOString(),
    }],
  };
  try {
    const res = await doFetch(env.DISCORD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      console.error("report: discord webhook failed, status", res.status);
      return json(502, { error: "notify_failed", message: "送信に失敗しました。しばらくしてからもう一度お試しください" });
    }
  } catch (error) {
    console.error("report: discord webhook request failed", error?.name ?? "error");
    return json(502, { error: "notify_failed", message: "送信に失敗しました。しばらくしてからもう一度お試しください" });
  }
  return json(200, { ok: true });
}
