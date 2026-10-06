# ADR-028: Cluster-wide limits on the room host, and host self-fencing

**Status:** Accepted (Phase 10).

## Context

Phase 10's abuse testing found two multi-instance weaknesses
([MODERATION_HARDENING.md](../design/MODERATION_HARDENING.md) F1, F2):

1. Per-session rate buckets lived only in each gateway instance. A client reconnecting
   through another instance (on Vercel, any new Function instance) got fresh buckets —
   including the room-code guessing limit.
2. When only the host's own Redis connection hung, it kept running match timers and bots
   for its local players while its lease expired and another instance restored the last
   snapshot: two hosts acting at once, and clients ignoring the new host's lower versions.

The brief asks for limits that work across instances, never two active hosts, and no
expensive per-tick work.

## Decision

- **Limits are counted on the room host.** Every request already reaches the single host
  (ADR-023), so its in-memory token buckets are cluster-wide without a Redis round trip
  per request. One table (`transport/eventBuckets.ts`) maps events to buckets; the gateway
  still applies them first as a cheap flood filter before forwarding. A per-IP budget for
  wrong room codes is kept on the host too; the address travels with the request and is
  only held in memory.
- **A host fences itself.** On every cluster tick (no extra timers), a host that can't reach
  the store — its previous tick is still waiting (ioredis queues commands while
  disconnected) or failed — and has not renewed for half the lease TTL stops hosting (timers
  and bots stop) before the lease can expire and anyone else acquire it. Elapsed time alone
  is not enough: Vercel freezes idle instances (no timer runs), and a thawed host whose
  store works must just renew — the first version stepped down after freezes and lost an
  unsaved room on production (found by the live security smoke, fixed in Phase 10). Writes
  stay fenced by the lease as before; ticks no longer pile up while the store is stuck.
- **Full states reset clients.** Whole-state match updates (reconnect, seat reclaim, a new
  host's restore) carry `reset: true`; the client store and animation director replace what
  they have even at a lower version.

## Consequences

- Limits hold whatever instance a client uses; they reset when the host role moves (rare,
  documented).
- At most one instance acts as host at any moment, even under a one-sided Redis partition
  (tested with a per-instance fault injector: hang, fail, and a freeze that must NOT step
  down). A host thawed after its lease expired renews unsuccessfully and stops; timers that
  fire in the instant before that are fenced and clients are reset by the new host.
- Progress a failed host made after its last commit is lost, never duplicated; clients
  snap back to the restored state.
- Rejected alternative: Redis-backed counters per request (a network round trip on every
  event, and Upstash quota) — unnecessary while one host serves every request.
