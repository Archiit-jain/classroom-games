// Vercel Function: the realtime game server (Socket.IO over WebSockets).
// The real code is bundled by `pnpm build` (apps/server/build.mjs → dist/vercel.mjs).
export { default } from '../apps/server/dist/vercel.mjs';
