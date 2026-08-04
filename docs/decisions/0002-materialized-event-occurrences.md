# 0002 — Recurring dances are materialized occurrence rows

## Status

Accepted. Resolves the second open question in AGENTS.md §14.

## Context

A dance (`dance_events`) usually repeats — "every Tuesday at 20:00". A dancer, though,
never cares about the series; they care about *tonight*. The question was whether a
specific night exists as a row, or is computed on demand by expanding the series'
RRULE.

## Decision

Occurrences are **materialized rows** in `event_occurrences`.

`dance_events.recurrence_rule` stays, but only as the **generator input** — it describes
the pattern. The `event_occurrences` row is the **source of truth for what actually
happens on a given night**, and once a row exists it outranks the rule that produced it.

## Why

Four things in AGENTS.md point the same way, and all four are load-bearing:

- **§9, proximity in Postgres.** The map is the hero screen with a 2.5s FCP budget, and
  proximity filtering must run in Postgres via `ST_DWithin`. An occurrence that doesn't
  exist as a row can't be reached by an index scan — we would have to expand rules in
  JavaScript and filter there, which §9 explicitly forbids. With rows, "dances near me
  in the next N hours" is one indexed query against `starts_at` plus a GIST index.
- **§10, cancellations are the critical path.** Cancelling or moving a single night
  attaches state (`status`, `cancellation_reason`, `override_venue_id`) to that night.
  A computed occurrence has no primary key to hang that on, so we would need an
  exceptions table keyed by `(event_id, starts_at)` — which is a materialized table with
  worse ergonomics and a composite natural key.
- **§10, Realtime.** Supabase Realtime broadcasts row changes. A cancellation is an
  `UPDATE` that subscribers receive for free. There is no realtime event for "the
  RRULE gained an exception".
- **§8, RLS.** Policies are row-based. Public read of occurrences is a trivial row
  policy; there is nothing to write a policy against if occurrences are computed.

## Consequences

- A generator must roll a horizon of future rows forward. It does not exist yet — see
  Open questions.
- Editing a series' rule means reconciling already-generated future rows, which is the
  awkward part of this design and the main thing we are accepting.
- `event_occurrences.overridden_at` marks a night a human has touched.
  **Invariant: the generator must never modify or delete a row where `overridden_at`
  is not null.** This is what stops a routine regeneration pass from silently
  resurrecting a cancelled dance or reverting a venue move — i.e. from breaking the
  exact §10 path this design exists to protect. The invariant is restated as a SQL
  comment on the column; it is *not* enforceable by a constraint, because the
  constraint would have to know which writer is writing.

## Open questions

Deliberately out of scope for this migration; not implemented, not designed around.

- **Horizon length.** How far ahead rows are generated (a fixed 90 days, per-series,
  or demand-driven). Affects table size and how far out the map can look.
- **Who runs the generator.** `pg_cron` inside Postgres, a Supabase Edge Function on a
  schedule, or an explicit instructor action. This also decides how the `overridden_at`
  invariant is enforced in practice — a `service_role` writer bypasses RLS, so the
  invariant currently rests on the generator's own code being correct.
