// Serves a production build the way Vercel does, on ONE origin: the static client
// (apps/client/dist) with the security headers from vercel.json, and the game-server
// Function (api/socket.mjs) for /api/socket/* (HTTP and WebSocket upgrades).
// For local production smoke tests only — not a deployment target.
//
//   pnpm build
//   ALLOWED_ORIGINS=http://localhost:4300 node tools/serve-production.mjs 4300
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'apps/client/dist');
const port = Number(process.argv[2] ?? 4300);
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
const globalHeaders = vercel.headers.find((h) => h.source === '/(.*)').headers;
const assetHeaders = vercel.headers.find((h) => h.source === '/assets/(.*)').headers;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

if (!existsSync(join(dist, 'index.html'))) {
  console.error('Build first: pnpm build');
  process.exit(1);
}

const { default: fn } = await import(new URL('../api/socket.mjs', import.meta.url).href);
// Route like Vercel: the Function's own path, plus vercel.json's rewrite applied literally, so
// a rewrite Vercel wouldn't match fails here too. Only "<prefix>(.*)" sources are emulated —
// Vercel's `:path*` does not match a trailing slash, and socket.io's path ends with one
// (`/api/socket/socket.io/?EIO=4…`).
const rewrite = vercel.rewrites.find((r) => r.destination === '/api/socket');
if (!/^\/[\w/-]*\(\.\*\)$/.test(rewrite?.source ?? '')) {
  console.error(`Unsupported rewrite source in vercel.json: ${rewrite?.source}`);
  process.exit(1);
}
const rewritePath = new RegExp(`^${rewrite.source}$`);
const isFunction = (url = '') => {
  const path = url.split('?')[0];
  return path === '/api/socket' || rewritePath.test(path);
};

const server = createServer((req, res) => {
  if (isFunction(req.url)) {
    fn.emit('request', req, res);
    return;
  }
  for (const { key, value } of globalHeaders) res.setHeader(key, value);
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(
    /^([/\\])+/,
    '',
  );
  let file = join(dist, path);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(dist, 'index.html');
  }
  if (file.includes(`${join('dist', 'assets')}`)) {
    for (const { key, value } of assetHeaders) res.setHeader(key, value);
  }
  res.setHeader('content-type', types[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});
server.on('upgrade', (req, socket, head) => {
  if (isFunction(req.url)) fn.emit('upgrade', req, socket, head);
  else socket.destroy();
});
server.listen(port, () => console.warn(`production-style server on http://localhost:${port}`));
