/**
 * Origin allowlist matching. Entries are exact origins ("https://example.com")
 * or a single leading-label wildcard ("http://*.localhost:5173"), which matches
 * exactly one subdomain label — never the bare host, never nested dots.
 */
export function isOriginAllowed(origin: string, allowed: readonly string[]): boolean {
  for (const entry of allowed) {
    if (entry === origin) return true;
    const star = entry.indexOf('://*.');
    if (star === -1) continue;
    const scheme = entry.slice(0, star + 3); // "http://"
    const rest = entry.slice(star + 4); // ".localhost:5173"
    if (!origin.startsWith(scheme) || !origin.endsWith(rest)) continue;
    const label = origin.slice(scheme.length, origin.length - rest.length);
    if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(label)) return true;
  }
  return false;
}
