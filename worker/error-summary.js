// 例外のログ用の要約（kit の共有ファイル。各サイトは submodule で読む）。
//   import { errorSummary } from "../external/fara-blazor-component/worker/error-summary.js";
// 報告（report.js）と、各サイトの Worker の例外ログで同じ規則を使う（サイトごとのコピーは持たない）。

/** ログに出す文の長さ（これより長いものは切る）。 */
export const ERROR_SUMMARY_MAX = 200;

/**
 * 秘密らしいものを取り除き、制御文字を空白にする（名前にもメッセージにも同じ規則）。
 * 取り除くもの: URL（Discord の Webhook の URL など）・Bearer のトークン・token=／token: の値・24 字以上の英数字の連続（Webhook のトークンなど）。
 * @param {string} text
 * @returns {string}
 */
function redact(text) {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/https?:\/\/\S+/g, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\btoken\s*[=:]\s*\S+/gi, "token=[redacted]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]");
}

/**
 * ログに出す例外の要約（名前とメッセージ。秘密らしいものは取り除き、長さを切る）。
 * Error 以外の値（文字列・オブジェクト・null）も文字列にして同じ規則に通す。文字列にできない値は中身を出さない。
 * @param {unknown} error
 * @returns {string} 「名前: メッセージ」
 */
export function errorSummary(error) {
  let name = "Error";
  let message;
  try {
    name = typeof error?.name === "string" ? error.name : "Error";
    const raw = error?.message ?? error ?? "";
    // Symbol は String() で中身が出てしまうので、文字列にせず固定の文にする
    message = typeof raw === "string" ? raw : typeof raw === "symbol" ? "（文字列にできない値）" : String(raw);
  } catch {
    message = "（文字列にできない値）";
  }
  return `${redact(name).slice(0, 40)}: ${redact(message).slice(0, ERROR_SUMMARY_MAX)}`;
}
