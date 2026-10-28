#!/usr/bin/env node
// 静的ファイルを簡易に配る（レイアウト計測の CI 用。Node だけで動く）。
//   node external/fara-blazor-component/tools/layout-check/serve-static.mjs publish/wwwroot 8820 [--not-found 404.html] [--spa]
// 引数: 配る元のフォルダ・開始ポート（既定 8820。使われていれば次のポート）。起動したら「配信中: <URL>」を出し、止めるまで動く。
// 解決の順（Cloudflare の静的アセットと同じ形）:
//   1. パスがファイルならそれ（末尾が / のときは、この手順を飛ばしてフォルダを先に見る）
//   2. <パス>.html
//   3. フォルダなら <パス>/index.html。無ければ <フォルダ>.html（/worlds/ → worlds.html）
// どれも無ければ 404。--not-found <file> を付けると、そのファイルを 404 のステータスのまま返す（SPA の 404 画面を測るため）。
// --spa を付けると、存在しないパスは index.html を 200 で返す（SPA のルーティング用）。--spa は --not-found より優先する。
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
};

/** 1 つの root を配るサーバー（まだ listen していない）。options: { notFoundFile?: string, spaFallback?: boolean }。 */
export function createStaticServer(root, options = {}) {
  const base = resolve(root);
  const notFoundFile = options.notFoundFile ? resolve(base, options.notFoundFile) : null;
  const spaFallback = options.spaFallback === true;
  return createServer(async (req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const target = resolve(join(base, pathname));
    if (target !== base && !target.startsWith(base + sep)) {
      res.writeHead(403).end();
      return;
    }
    const file = await findFile(base, target, pathname.endsWith("/"));
    if (file) {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
      return;
    }
    if (spaFallback) {
      const index = join(base, "index.html");
      if (await isFile(index)) {
        res.writeHead(200, { "Content-Type": TYPES[".html"] }).end(await readFile(index));
        return;
      }
    }
    if (notFoundFile && (await isFile(notFoundFile))) {
      res.writeHead(404, { "Content-Type": TYPES[".html"] }).end(await readFile(notFoundFile));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
  });
}

async function isFile(path) {
  const info = await stat(path).catch(() => null);
  return info?.isFile() === true;
}

async function isDirectory(path) {
  const info = await stat(path).catch(() => null);
  return info?.isDirectory() === true;
}

/**
 * パスに対応するファイルを探す。候補は必ず root の中にあるものだけ（root の外の <path>.html を返さない）。
 * @param {string} base 配る元のフォルダ（絶対パス）
 * @param {string} target パスを解決した絶対パス
 * @param {boolean} trailingSlash パスが / で終わるか（フォルダを先に見る）
 * @returns {Promise<string | null>}
 */
export async function findFile(base, target, trailingSlash) {
  const inside = (path) => path === base || path.startsWith(base + sep);
  const candidates = [];
  if (!trailingSlash) {
    candidates.push(target, `${target}.html`);
  }
  if (await isDirectory(target)) {
    candidates.push(join(target, "index.html"), `${target}.html`);
  } else if (trailingSlash) {
    candidates.push(`${target}.html`);
  }
  for (const candidate of candidates) {
    if (inside(candidate) && (await isFile(candidate))) return candidate;
  }
  return null;
}

/**
 * startPort から空いているポートで配る。使われていれば次へ（最大 tries 個）。
 * @param {string} root 配る元のフォルダ
 * @param {number} startPort 開始ポート
 * @param {{ host?: string, tries?: number, notFoundFile?: string, spaFallback?: boolean }} options
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function startStaticServer(root, startPort = 8820, { host = "127.0.0.1", tries = 50, notFoundFile, spaFallback } = {}) {
  for (let port = startPort; port < startPort + tries; port += 1) {
    const server = createStaticServer(root, { notFoundFile, spaFallback });
    const listened = await new Promise((resolveListen) => {
      server.once("error", () => resolveListen(false));
      server.listen(port, host, () => resolveListen(true));
    });
    if (listened) {
      return {
        origin: `http://${host}:${port}`,
        close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
      };
    }
  }
  throw new Error(`${startPort} から ${tries} 個のポートがすべて使われている`);
}

/** コマンドの引数を読む（位置の引数: 配る元・ポート。フラグ: --not-found <file>・--spa）。 */
export function parseServeArgs(argv) {
  const positional = [];
  const options = { notFoundFile: undefined, spaFallback: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--not-found") {
      options.notFoundFile = argv[i + 1];
      i += 1;
      if (!options.notFoundFile) throw new Error("--not-found にはファイルのパスを書く");
    } else if (arg === "--spa") {
      options.spaFallback = true;
    } else {
      positional.push(arg);
    }
  }
  return { root: positional[0] ?? "publish/wwwroot", port: Number(positional[1] ?? 8820), options };
}

// コマンドとして起動したときだけ、配信を始める（テストから import したときは動かない）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { root, port, options } = parseServeArgs(process.argv.slice(2));
  const server = await startStaticServer(root, port, options);
  console.log(`配信中: ${server.origin}（元: ${resolve(root)}）`);
}
