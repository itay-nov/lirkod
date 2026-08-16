# 0023 — Dance attributes (level, formations, women-only) are protected by ownership RLS, not a column-scoped grant

## Status

Accepted.

## Context

Phase 4.6b (docs/decisions/0002, 0004 for the surrounding conventions) adds three
instructor-set attributes to a dance: `level`, `dance_formations`, `women_only`. The task
asked for the same "own-row / column-scoped-grant" boundary migration 0011 built for
`profiles.avatar_id`: revoke the table-wide grant, re-grant only the new columns.

`dance_events` cannot take that shape without breaking existing, intentional behaviour.

Unlike `profiles` and `instructors`, `dance_events` has held a **table-wide** INSERT/UPDATE
grant to `authenticated` since migration 0001:

```sql
grant select, insert, update, delete on public.dance_events to authenticated;
```

Migration 0009 restates this explicitly when it added the `recurrence_*` columns — "the
same twelve-hour ceiling ... restated here because `authenticated` holds a plain UPDATE
grant on this table and can therefore write these columns without going through the
RPC" — and defends those columns with CHECK constraints rather than a narrower grant.
`tests/rls/rls.test.ts` ("lets an instructor change the price of their own dance") asserts
an instructor can update `price_agorot` directly, outside any RPC, today.

## Decision

The three new columns get the same protection every other `dance_events` column already
has: the table-wide grant, unchanged, plus `dance_events_insert_own` /
`dance_events_update_own` (`owns_instructor(instructor_id)`, USING and WITH CHECK). That
already satisfies the two properties that actually matter:

- **An instructor writes these only on their own event.** `dance_events_update_own`'s
  USING clause denies the row before any column is considered.
- **A non-owner cannot write them at all.** Same policy's WITH CHECK, same as it already
  denies a non-owner's `price_agorot` write — verified in `tests/rls/rls.test.ts`, and
  extended for the three new columns in this phase's tests.

Narrowing the grant to just these three columns was rejected: it would leave
`price_agorot`, `venue_id`, and `dance_types` unwritable through a direct PostgREST
update, silently breaking the existing, passing "lets an instructor change the price of
their own dance" test and everything else that relies on `dance_events`' broad-grant,
constraint-defended design. That is an unrelated RLS change with real blast radius
(AGENTS.md §13: never change RLS code as a side effect of an unrelated task), not
something this phase's three columns should trigger as a side effect.

## Consequences

- No new GRANT statements in migration 0013 for `dance_events`. The columns are added,
  the ownership policies already cover them, and `dance_events_select_public` (`using
  (true)`) already makes them anon-readable the moment they exist.
- `instructors.verified` (the project's existing "did a grant statement leak privilege"
  canary — migrations 0004/0011) is asserted to stay unwritable in this phase's RLS
  suite too, as a regression check that this migration touched nothing it should not
  have — not because it is related to dance attributes.
- If `dance_events` ever needs a column-scoped grant (a genuinely sensitive column like
  `verified` is on `instructors`), that is its own migration, informed by this one: it
  would first have to resolve what happens to the columns already relying on the
  table-wide grant.
