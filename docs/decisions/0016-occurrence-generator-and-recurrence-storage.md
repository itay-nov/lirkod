# 0016 — The occurrence generator: horizon, ownership, and where a recurrence is stored

## Status

Accepted. Closes both open questions in docs/decisions/0002, and the recurrence
half of the AGENTS.md §14 list.

## Context

0002 decided that a night is a materialised `event_occurrences` row and left two
things open on purpose: **how far ahead** rows are generated, and **who runs the
generator**. It also said `dance_events.recurrence_rule` is "the generator input",
without saying what that text looks like or what else a generator would need.

3.3a is the phase that has to answer all three, because the generator is the thing
being built.

## Decision

### The recurrence model

v1 is **weekly or every other week, on the weekday of the series' first night, at
a fixed Israel wall-clock time, from a start date, optionally until an end date**.
Not a general RRULE. No monthly, no "second Tuesday", no exception dates in the
rule — an exception is a row, which is the whole of 0002.

It is stored as typed columns on `dance_events`:

```
recurrence_freq            enum ('weekly','biweekly')  -- null = does not repeat
recurrence_start_date      date   -- the first night; also the weekday and the biweekly phase
recurrence_until_date      date   -- optional, inclusive
recurrence_local_start_time time  -- Asia/Jerusalem wall clock
recurrence_local_end_time   time  -- Asia/Jerusalem wall clock
```

`recurrence_rule` **stays**, still holds RRULE text, and is now a **stored
generated column** derived from those — `FREQ=WEEKLY;BYDAY=TU`,
`FREQ=WEEKLY;INTERVAL=2;BYDAY=SU`. It cannot be written to.

### The horizon

**90 days**, as a default on the generator, not a column. `find_dances_near` and
the anonymous read policy both stop at 60 days (migrations 0003 and 0005), so the
window a dancer can see is always fully materialised with a month of slack. The
generator refuses a horizon over 730 days rather than clamping it.

### Who runs it

**pg_cron**, daily, as `postgres`. `public.generate_occurrences()` is SECURITY
DEFINER and its EXECUTE is revoked from `public` — which includes `anon`,
`authenticated` and `service_role` — and granted only to `postgres`.

The algorithm itself lives one level down, in
`public.generate_occurrences_for_event(event_id, horizon_days)`, which is SECURITY
**INVOKER** and granted to `authenticated`. The publishing RPC calls it so a new
series is on the map immediately instead of after the next nightly pass.

## Why

### Typed columns rather than a rule string the generator parses

0002's literal wording points at a text blob the generator reads. That reading was
rejected, and it is the main place this ADR diverges from its predecessor.

Everything the generator has to be *right* about is a date, a time, or an
interval. Parsing those out of a string, in SQL, is where the bugs would be — on
the surface AGENTS.md §10 and §7 both single out as safety-critical. A `date`
column compared as a date cannot be misparsed, and a `CHECK` constraint can hold
the set of them coherent (all four or none; an end date not before the start; a
night under twelve hours) in a way no text format can.

The wall-clock **time** columns matter as much as the pattern. A series does not
happen at a UTC offset — it happens at 20:00 — and storing an instant would force
every later night to be derived by adding to it, which is exactly the drift §7
forbids.

### But `recurrence_rule` still exists, and is generated

Deleting it would have contradicted 0002 outright. Leaving it writable would have
created two independent sources of truth for the same fact, which is the failure
0003 exists to make unrepresentable in the neighbouring pair of columns: a row
could claim `BYDAY=TU` while the schedule columns produced Thursdays, and whoever
next read that string would be reading the half nothing acts on.

Generated is the version where both survive: the text is present, legible, and
available to a future full-RRULE implementation, and Postgres guarantees it agrees
with what is actually generated. Writing it fails with 428C9.

It carries the repeat **pattern** only (FREQ/INTERVAL/BYDAY). In RFC 5545 terms
DTSTART, DURATION and UNTIL belong to the event rather than to the pattern, and
here they are the typed columns — UNTIL included, because the generator compares it
as a date and a text UNTIL would only have to be parsed back into one. That is a
narrowing of what the column held before and is stated on the column comment.

### The weekday is not its own column, or its own form field

`recurrence_start_date` already answers "which weekday" and "where does a biweekly
series' phase sit". A separate weekday would be a second fact that can disagree
with the first, and someone would then have to decide which wins.

The same argument settles the form. The publish form already asks for a date; a
weekday selector next to it is one more control for an audience AGENTS.md §2
describes, and two fields that can contradict each other. So the form gained one
control — one-time / weekly / every other week — and an optional end date, and it
*states* the weekday it derived ("ההרקדה תחזור ביום ראשון, לפי התאריך שבחרתם")
rather than asking for it again.

### 90 days

Long enough that the 60-day read window is always full with a month of slack, so a
missed nightly pass — or a few — is invisible to a dancer. Short enough that the
table stays small and that changing a series' rule later (deferred, see below) does
not mean reconciling a year of rows.

It is a default on the function rather than a per-series column because nothing in
the product varies it, and a column would be a knob nobody turns that every reader
has to account for (AGENTS.md §8: no fields "for later").

### SECURITY DEFINER, here and nowhere else

Migration 0006 argues at length that a DEFINER `publish_dance` would be a hole
through every ownership policy in the schema. Nothing about that argument has
changed; what has changed is the caller.

The nightly top-up is a system job. It writes across every instructor's events, it
has no session, and the row-level policies it would otherwise be subject to are all
written in terms of `auth.uid()`. There is no caller whose RLS should apply, so
DEFINER is the honest description of it.

The mitigation is that it is not an API surface at all: no role reachable from a
client can execute it, `service_role` included. That last one is deliberate — it
bypasses RLS, so a server-side caller holding it would be a second, unaudited way
to write occurrences.

The per-event entry point is the opposite and for the opposite reason: it *does*
have a caller, so it runs as them and its INSERT is checked by
`event_occurrences_insert_own`. One algorithm, two privilege models, no
re-implemented ownership check.

### The idempotency key is the slot, not the timestamp

`(event_id, starts_at)` is the obvious key and it is wrong in the case that matters
most. An instructor who moves one night an hour later edits `starts_at` and sets
`overridden_at`. Keyed on the timestamp, the rule's original slot then looks empty
and the next pass puts the 20:00 night back — the dancer sees the same evening
twice, an hour apart, one of them the one the instructor thought they had moved.

So a generated row records `event_occurrences.series_date`, the calendar date of
the slot it came from, and the unique index is `(event_id, series_date)` where
`series_date is not null`. The night can then be moved, cancelled, or moved again;
the slot stays taken. Null for a night a person added by hand, which is why the
index is partial.

### How the `overridden_at` invariant is actually enforced

0002 states it and notes it is not expressible as a constraint, because it
constrains the writer rather than the row. It is enforced structurally instead:

**the generator contains no UPDATE and no DELETE.** Its only write is
`INSERT ... ON CONFLICT (event_id, series_date) DO NOTHING`.

That is stronger than checking `overridden_at is null` before writing. A check is a
rule a later branch of the same function can forget; an insert-only function has no
branch in which to forget it. The row that is already there wins, and the statement
has no way to express anything else.

### DST

Each night's instant is `(slot_date + local_time) AT TIME ZONE 'Asia/Jerusalem'` —
a lookup in the timezone database for that specific date. Slot dates are stepped as
**dates**, where a week is seven calendar days and no offset is involved.

This is the SQL counterpart of `src/lib/domain/jerusalemTime.ts`, which does the
same lookup through `Intl` for a one-off night. Two independent readers of the same
IANA data is a risk, so `tests/db/occurrenceGenerator.test.ts` asserts they agree
night by night across a 400-day series — a window that always contains both of
Israel's transitions, so the test does not expire.

## Consequences

- A recurring dance published today is on the map today; the cron pass only rolls
  the far edge forward.
- Deleting an occurrence is not an override. The generator will put it back on the
  next pass, because a deleted row leaves no `series_date` to occupy the slot.
  Cancelling is the supported action and the one 3.3b's UI will offer.
- `series_date` and the five `recurrence_*` columns are anonymous-readable, like
  everything else on these two tables. They describe a public dance, not a person.
- **Editing a series' rule is still not implemented.** 0002 named reconciling
  already-generated rows as the awkward part of the materialised design, and it
  stays open: nothing here decides what happens to next month's nights when a
  weekly dance moves from Tuesday to Wednesday. Changing the recurrence columns on
  an existing event today leaves every already-materialised night where it was and
  generates the new pattern alongside it, which is very unlikely to be what anyone
  wants. Whoever builds 3.3b owns this.

## Outstanding

- **The cron job must exist in the hosted project.** The migration runs
  `create extension if not exists pg_cron` and `cron.schedule(...)`, which works on
  the local stack. If the hosted project refuses the extension, enable it once from
  the dashboard (Database → Extensions) and re-run the migration. Nothing else
  depends on cron — the functions stand on their own, and every test invokes them
  directly rather than waiting for a job to fire.
- The schedule is `0 0 * * *`, which pg_cron reads as **UTC** (`cron.timezone` is a
  server-wide GUC set to GMT, not something to change from a migration). That is
  03:00 in Israel in summer and 02:00 in winter. With a 90-day horizon a pass is
  about 89 days early, so the hour is not load-bearing.
