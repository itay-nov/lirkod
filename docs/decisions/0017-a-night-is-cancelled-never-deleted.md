# 0017 — A night is cancelled, never deleted

## Status

Accepted. Governs the per-night write path added in Phase 3.3b.

## Context

3.3a made a recurring dance into rows: `public.generate_occurrences()` runs
nightly under pg_cron and materialises every series' nights up to a 90-day
horizon (docs/decisions/0016). 3.3b gives an instructor the controls to change
one of those nights — take it off, or move it to a different hour.

That is the first write in this product that edits a row the *system* also
writes. Everything before it was a human creating something no job would ever
touch again.

## Decision

**Cancelling is a soft cancel and there is no delete.** Taking a night off sets
`status = 'cancelled'` and a reason on the existing row. `DELETE` on
`event_occurrences` has been removed from `authenticated` outright (migration
0010) — not discouraged in the application, removed at the privilege layer.

**Moving a night's hour is an in-place `UPDATE`.** `starts_at` and `ends_at`
change; `series_date` does not, and cannot — it is outside `authenticated`'s
UPDATE grant.

Four rules, four different mechanisms, all in migration 0010:

| Rule | Mechanism |
|---|---|
| A client never deletes a night | policy dropped + `REVOKE DELETE` |
| A client never writes `series_date` | column-scoped `GRANT UPDATE` |
| Every change is marked | `BEFORE UPDATE` trigger stamping `overridden_at` |
| A marked night never looks normal | `CHECK` constraint |

## Why

### Delete is the obvious answer and it is the dangerous one

The generator skips a recurrence slot because **a row exists in it** — the key is
`(event_id, series_date)` and the write is `INSERT … ON CONFLICT DO NOTHING`.
Nothing about the row's contents is consulted.

So deleting a night frees its slot, and the next nightly pass re-creates the
night: original time, `status = 'scheduled'`, no reason, no marker. An instructor
who cancelled a dance on Tuesday finds it back on Wednesday morning, and every
dancer is told it is on.

That is worse than the feature never having shipped. AGENTS.md §10 calls
cancellations the product's most important moment; this would be that moment
failing on a delay, silently, in a way the instructor has no reason to re-check.

A soft cancel keeps the slot occupied, keeps the reason, and keeps the "בוטל" a
dancer has to see.

### The enforcement is in the database, not in the Server Action

The action is not the only caller. `authenticated` is a real PostgREST role and
an instructor's token works against `/rest/v1/event_occurrences` directly, so a
rule that lives only in `src/app` is a rule that holds until someone opens a
network tab.

Hence a privilege revoke rather than an application convention, a column-scoped
grant rather than "we don't send that field", and a trigger rather than "the
action always sets `overridden_at`". `tests/rls/manageNights.test.ts` asserts
every one of them against a raw client that skips the application, and each was
mutation-checked by restoring the privilege and watching the test fail.

### `overridden_at` is stamped, not supplied

It is the one of the four rules the generator does not read — 3.3a's safety rests
on the slot being occupied, not on anything in the row. That is exactly why it is
worth automating: a marker nothing enforces is right until the first caller
forgets it, and by then the audit trail it existed for is gone.

The trigger also refuses to clear an existing stamp. A night a person touched
stays a night a person touched, even if every field is put back.

### A cancelled night stays visible

Not hidden, not filtered out of `find_dances_near`, not dropped from `/schedule`
or the map. The row keeps coming back to an anonymous visitor with
`status = 'cancelled'`, and the UI draws "בוטל".

This is the existing rule, not a new one — migration 0002's comment, migration
0005's policy note and AGENTS.md §2.6/§10 all say the same thing — and it is
restated here because "cancel" instinctively reads as "remove". A dancer who
already made plans learns nothing from an absence; a hall they drive to and find
dark is the failure the whole product exists to prevent.

### A time move keeps `status = 'scheduled'`, so it needed a column

docs/decisions/0003 gives `'moved'` to a venue change and forbids it without a
new venue, and says in as many words that a time-only move "needs its own column
and a new migration relaxing this constraint".

Migration 0010 adds `original_starts_at` rather than a fourth enum value. Adding
an enum value is the option that looks smaller and is not: Postgres refuses to
use a new enum value in the transaction that created it, which is exactly how
Supabase runs a migration. The column also carries more — a dancer is told
"הועבר מ-20:00" rather than a bare "changed", which is what someone who already
planned around 20:00 needs to recognise the evening.

Without it, moving a night would have been the one change nobody is told about:
the status stays `'scheduled'`, so the row renders as an ordinary dance at a new
hour. That is §10's failure arriving through the feature built to prevent it.

## Consequences

- **There is no un-cancel.** Restoring a night to `'scheduled'` is a legal write
  and the constraint permits it (the mark stays), but no control offers it. A
  mis-tap is protected against with a two-step confirmation instead. If this
  turns out to be the wrong trade, the write already works — it needs a button
  and a sentence about what a dancer who saw "בוטל" is then told.
- **Deleting a whole dance still works and still cascades.** That is a different
  action: the series stops existing, so there is no rule left to regenerate from.
  It is how an instructor unpublishes.
- **A one-off night cannot be removed either**, only cancelled. It has no
  `series_date` and no generator would resurrect it, so the ban is stricter than
  it strictly needs to be. Kept uniform on purpose: "an instructor can delete
  some nights but not others" is a rule nobody will remember correctly, and
  deleting the sole night of a one-off dance would leave the publicly readable
  orphan docs/decisions/0014 is about.
- **`series_date` is now immutable to clients**, so a future feature that needs
  to move a night to a different DATE cannot do it through this path. That is
  deliberate — moving a night across days changes which slot it occupies, and
  what should then happen to the vacated slot is a real product question, not
  something to leave to whoever writes the update first.
- The manage list reads through the caller's own session with an explicit
  instructor filter. `event_occurrences_select_authenticated` is `using (true)`,
  so RLS filters nothing there — the same trap `findOwnInstructor` fell into
  against the world-readable `instructors` table, and the reason
  `tests/rls/manageNights.test.ts` pins it.

## Out of scope

- **Editing a series' rule** remains unimplemented and remains the awkward part
  of the materialised design (docs/decisions/0002, 0016). Nothing here decides
  what happens to already-generated nights when a weekly dance moves from Tuesday
  to Wednesday.
- **Moving one night to a different venue** is representable (`status = 'moved'`
  plus `override_venue_id`, per docs/decisions/0003) and is asserted at the
  database in `tests/rls/rls.test.ts`, but no control offers it yet. The label and
  the read path are already in place for when one does.
- **Telling a dancer a night changed.** This phase makes the change visible to
  anyone who looks; it does not push it to anyone who does not. That is Web Push
  and the SMS fallback (AGENTS.md §10), and it is the piece that makes a
  cancellation reach someone who already left the house.
