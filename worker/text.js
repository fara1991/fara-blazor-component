// 利用者の文字列・設定の文字列の整え方（報告の本文・メンテナンスの文）。worker/report.js と worker/maintenance.js が共有する（kit の共有ファイル）。
// 各サイトは submodule で worker/report.js などを import し、この相対 import（./text.js）もいっしょにバンドルされる。

/**
 * 制御文字（改行・タブ以外）と、対になっていないサロゲートを取り、前後の空白を取り、長さ（文字数。絵文字は 1 文字）を切る。
 * 文字列でなければ空。UTF-16 のまま切ると絵文字が割れて、Discord や画面が受け付けないことがあるため、文字単位で数える。
 * @param {unknown} value
 * @param {number} max 文字数の上限
 * @returns {string}
 */
export function cleanText(value, max) {
  if (typeof value !== "string") return "";
  const text = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
    .trim();
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join("").trim() : text;
}
