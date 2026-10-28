#!/usr/bin/env node
// 静的ファイルを簡易に配る（レイアウト計測の CI 用。Node だけで動く）。
//   node external/fara-site-kit/tools/layout-check/serve-static.mjs publish/wwwroot 8820
// 引数: 配る元のフォルダ・開始ポート（既定 8820。使われていれば次のポート）。起動したら「配信中: <URL>」を出し、止めるまで動く。
// パスが「ファイル」でなければ「<パス>.html」を探す（kit の静的ページの形: /works → works.html）。フォルダなら index.html。
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

/** 1 つの root を配るサーバー（まだ listen していない）。 */
export function createStaticServer(root) {
  const base = resolve(root);
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
    try {
      const file = await findFile(target);
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
    }
  });
}

async function findFile(target) {
  const info = await stat(target).catch(() => null);
  if (info?.isFile()) return target;
  if (info?.isDirectory()) return join(target, "index.html");
  if (!extname(target)) return `${target}.html`;
  throw new Error("not found");
}

/**
 * startPort から空いているポートで配る。使われていれば次へ（最大 tries 個）。
 * @returns {Promise<{ origin: string, close: () => Promise<void> }>}
 */
export async function startStaticServer(root, startPort = 8820, { host = "127.0.0.1", tries = 50 } = {}) {
  for (let port = startPort; port < startPort + tries; port += 1) {
    const server = createStaticServer(root);
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

// コマンドとして起動したときだけ、配信を始める（テストから import したときは動かない）。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root = "publish/wwwroot", port = "8820"] = process.argv.slice(2);
  const server = await startStaticServer(root, Number(port));
  console.log(`配信中: ${server.origin}（元: ${resolve(root)}）`);
}
