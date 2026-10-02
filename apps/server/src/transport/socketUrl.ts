/**
 * Vercel routes `/api/socket/*` to the game-server Function. Depending on how the
 * platform presents the URL, the Function may see the full path or only its own
 * route; Socket.IO listens on `socketPath` (default `/socket.io`), so the URL is
 * normalised to that before Socket.IO's listeners run.
 */
export function normalizeSocketUrl(url: string, socketPath: string): string {
  const at = url.indexOf(socketPath);
  if (at >= 0) return url.slice(at);
  // "/api/socket?EIO=4…" or "/api/socket/?EIO=4…" → "/socket.io/?EIO=4…"
  const match = /^\/api\/socket\/?(\?.*)?$/u.exec(url);
  return match ? `${socketPath}/${match[1] ?? ''}` : url;
}
