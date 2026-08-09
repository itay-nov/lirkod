# 0012 — Per-IP rate limiting on /api/dances/near is a speed bump, not a fix

## Status

Accepted, and **explicitly incomplete**. Read "What this does not fix" before
citing it as a control.

## Context

A Codex review of Phase 2.4 raised `POST /api/dances/near` as a P1: it is public,
unauthenticated, and runs a PostGIS proximity query per call with nothing limiting how
often anyone may ask.

The same review made the point that matters most, and it is the reason this ADR exists
rather than a one-line "added rate limiting" in a commit message: **the route is not
the only way in.** `find_dances_near` is `SECURITY INVOKER` and executable by `anon`
(docs/decisions/[0005](./0005-proximity-query-as-rpc.md)), so anyone can skip our
handler entirely:

```
POST /rest/v1/rpc/find_dances_near   { "p_lat": …, "p_lng": …, "p_radius_meters": … }
```

with the anon key that ships in the JavaScript bundle. Limiting our route and calling
the finding closed would be the same mistake [0010](./0010-anon-raw-table-reads-are-time-bounded.md)
described as "a front door on a building with the side door propped open".

## Decision

Add a per-IP sliding-window limiter to the route: **10 requests per minute**, answered
with `429` and a `Retry-After` header. `src/lib/domain/rateLimit.ts` holds the logic —
pure, clock-injected, unit-tested, with a bounded key table so the limiter cannot
itself be turned into a memory-exhaustion vector.

The check runs before body parsing and long before Postgres, so a refused request costs
almost nothing.

Ten a minute is deliberately generous. The control it protects is a button a dancer
presses; a whole building behind one NAT address shares this budget, and refusing a
real person the feature is a worse failure for this product than serving a scraper a
few hundred extra rows (AGENTS.md §2).

## What this does not fix

Stated plainly, because a partial control described as a complete one is worse than no
control — someone will later read "rate limited" and stop looking.

1. **It is in-memory, per process.** The counters live in one server instance's heap.
   Vercel runs many instances and recycles them freely, so the real ceiling is 10/min
   *multiplied by* however many instances are warm, and a cold start resets a caller's
   budget to zero. There is no global number here, and no way to produce one from
   process memory.
2. **It does not bound the data, only this route.** The direct RPC path above is
   untouched. A caller who wants the query unthrottled simply does not use our
   endpoint. Everything this limiter stops, it stops only for callers who were using
   the front door anyway.
3. **`x-forwarded-for` is trustworthy only behind a proxy that sets it.** On Vercel it
   is set by the platform. Self-hosted, or behind a misconfigured proxy, it is a header
   the caller writes — and varying it defeats the limit completely.
4. **An IP is a poor identity for this audience.** CGNAT puts a whole neighbourhood on
   one address, so one abuser can exhaust a budget shared with real dancers; IPv6
   rotation hands one abuser a fresh address whenever they want.

What it genuinely buys: a runaway loop in our own client, and casual scripted abuse
aimed at the documented endpoint, now stop cheaply. That is worth having. It is not
protection.

## What full protection would need

Out of scope for this task, listed so the next person does not have to re-derive it:

- **Distributed limiting** — Upstash/Redis or the platform's own edge limiter — so the
  budget is one number across instances rather than one per heap.
- **Limiting at the database**, which is the only layer both doors pass through.
  Options worth evaluating: a counter table plus a trigger or a wrapper function; a
  Supabase Edge Function in front of the RPC with the direct grant revoked; or
  PostgREST-level limits if they ever gain per-role granularity (they do not today —
  see 0010's `db-max-rows` finding).
- Note that the obvious shortcut — make `find_dances_near` `SECURITY DEFINER` and
  revoke `anon`'s execute — is ruled out on other grounds by 0005 and 0010, so it is
  not the easy answer it looks like.

## Consequences

- A `429` reaches the client as the same "לא הצלחנו לאתר אותך" sentence every other
  locate failure produces (0011 decided one message for causes a dancer cannot act on).
  A rate-limited dancer is told the location failed, which is not quite what happened.
  Given the limit is ten presses a minute, a real person should never see it.
- The limiter's state is per instance, so `tests/unit/dancesNearRoute.test.ts` shares
  one module-scoped instance across its cases and gives each test its own source
  address. Anything asserting exhaustion has to do the same.
- 0010 closed by saying rate limiting was "still not addressed anywhere". That is now
  partly false and this ADR is the whole of the difference — one route, one process,
  bounded as described above.
- Nothing here touches Google Maps API usage, which 0011 lists as separately
  unlimited. That remains open and is a billing exposure rather than a data one.
