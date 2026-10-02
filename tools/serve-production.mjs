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
const isFunction = (url = '') => url.startsWith('/api/socket');

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
