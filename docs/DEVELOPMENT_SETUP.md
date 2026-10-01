# Development setup

## Requirements

- **Node.js 24 or newer** (`.node-version` pins the major version)
- **pnpm 11 or newer** (`packageManager` in `package.json` pins the exact version)
- Git

## Install and run

```bash
pnpm install
pnpm dev
```

- Client: http://localhost:5173 (Vite dev server)
- Server: http://localhost:3001 (`tsx watch` — restarts on file changes)
- Health check: http://localhost:3001/healthz

`pnpm dev:server` and `pnpm dev:client` run them separately. Run these from the
`Classroom Games` folder (the repository root), not its parent.

If the page shows **"Can't reach the game server … it isn't running"**, only the client is
up: start the server (`pnpm dev` or `pnpm dev:server`). The page reconnects by itself — no
reload needed. Development builds show this message instead of the production
"Waking up the game server…", because a local server is never asleep.

> Every server restart (including automatic restarts in watch mode) ends all rooms and
> sessions — they live in memory. Open clients reconnect with a new session and return to
> the home screen. This is expected.

## Playing with several players on one machine

Each browser _origin_ has its own storage, so each gets its own anonymous session.
Development defaults allow any `*.localhost:5173` origin, so you can open:

- http://localhost:5173 — player 1
- http://p2.localhost:5173 — player 2
- http://p3.localhost:5173 — player 3

(A private/incognito window also works.) Two tabs on the same origin are the _same_
player: the newer tab takes over and the older one shows "You opened Classroom Games in
another tab".

## Testing on a phone on the same Wi-Fi

1. Start the client so it listens on your network: `pnpm --filter @cg/client dev --host`.
2. Allow the phone's origin on the server, e.g.
   `ALLOWED_ORIGINS=http://192.168.1.20:5173 pnpm dev:server` (use your computer's IP).
3. Open `http://<your-ip>:5173` on the phone. The client connects to port 3001 on the
   same host automatically.

## Environment variables

### Server (`apps/server`)

| Variable              | Default                                                               | Meaning                                                                                                                      |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                | `3001`                                                                | HTTP/WebSocket port                                                                                                          |
| `HOST`                | `0.0.0.0`                                                             | Bind address                                                                                                                 |
| `ALLOWED_ORIGINS`     | `http://localhost:5173,http://127.0.0.1:5173,http://*.localhost:5173` | Comma-separated browser origins allowed to connect. `*.` matches exactly one subdomain label. **Must be set in production.** |
| `TRUST_PROXY`         | `false`                                                               | Read the client IP from the last `X-Forwarded-For` entry (only behind a trusted proxy)                                       |
| `ENABLE_FIXTURE_GAME` | `true`                                                                | Register the fixture game. Always forced off when `NODE_ENV=production`.                                                     |
| `LOG_LEVEL`           | `info`                                                                | `silent`, `error`, `warn`, `info`, `debug`                                                                                   |
| `GAME_TIME_SCALE`     | `1`                                                                   | Multiplies game phase timers (e.g. `0.3` for quick test games; e2e uses `0.25`). Always `1` when `NODE_ENV=production`.      |
| `NODE_ENV`            | —                                                                     | `production` disables the fixture game                                                                                       |

All other tunables (timers, limits, rate limits) are in `apps/server/src/config.ts`
(`DEFAULT_CONFIG`) and can be overridden in code (tests do this).

### Client (`apps/client`)

| Variable          | Default                             | Meaning                                          |
| ----------------- | ----------------------------------- | ------------------------------------------------ |
| `VITE_SERVER_URL` | `<page protocol>//<page host>:3001` | Game server URL. See `apps/client/.env.example`. |

## Useful commands

| Command                                     | Purpose                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm test` / `pnpm test:watch`             | Vitest (unit + integration)                                                                              |
| `pnpm vitest run packages/moderation`       | Run one package's tests                                                                                  |
| `pnpm e2e`                                  | Playwright (starts both servers if not running)                                                          |
| `PW_CHANNEL=msedge pnpm e2e`                | Use an installed Edge instead of downloading Chromium (PowerShell: `$env:PW_CHANNEL='msedge'; pnpm e2e`) |
| `pnpm lint`, `pnpm typecheck`, `pnpm check` | Static checks                                                                                            |
| `pnpm format`                               | Prettier                                                                                                 |
| `pnpm build`                                | Production builds                                                                                        |

## Windows notes

- The project folder name contains a space (`Classroom Games`); all scripts handle it.
- In PowerShell, pnpm writes progress to stderr, which PowerShell shows in red. That is
  not an error — check the exit code/summary line.
