# 0014 — An instructor publishes one dance (Phase 3.2a)

**Status:** accepted
**Builds on:** 0002 (materialised occurrences), 0004 (public and private identity),
0013 (phone-OTP sign-in and the inline /profile pattern)

## Context

This is the first authenticated *write* in the product. Everything before it was
either a public read or an auth flow. The RLS policies it needs were written in
migration 0001 and tightened in 0004 — none of them changed here — so the work
was building the surface on top and proving the policies actually hold.

## What is stored, and what is not

`dance_events` has **no `title` and no `note` column**, and nothing in the read
path (`find_dances_near` → the ring list, the map pins, the schedule) renders
either. So the form collects only what maps to real columns: venue, date, start
time, end time.

Collecting a title anyway would have meant one of two bad outcomes: a column
nobody reads, which is precisely the "fields for later" AGENTS.md §8 rules out;
or changing `find_dances_near` and three components to display it, on the same
change as the first authenticated write. The product already identifies a dance
as venue + instructor + time — that is exactly what `he.dance.mapPinLabel`
renders — so nothing is missing on screen. Title and note come back when there is
a dance-detail route to show them on.

**`price_agorot` is written as 0**, and that is a placeholder rather than a claim
that the dance is free. The column is `NOT NULL` with no default and pricing is
out of scope for this phase, so something had to go in. Nothing renders a price
today, so it is invisible — but whoever builds pricing must be able to tell "we
never asked" from "the instructor said it costs nothing", and right now they
cannot. That is a real modelling gap, not a resolved question.

## Three inline states on /profile

`/profile` stays in `(public)` and keeps the shape 0013 established: no session →
sign in; session but no `profiles` row → set a name; both → the profile and the
publish form. None of them is a redirect.

The name step cannot be skipped, because `profiles.display_name` is `NOT NULL`
with no default — there is no profile row until it is answered, and nothing
downstream can happen first. The sign-out button is rendered **alongside** it for
that exact reason: a mandatory form with no way out strands anyone who signed in
with the wrong number.

## Registration is folded into the first publish, but the public name is not

Becoming a מרקיד happens as part of publishing rather than as a separate step —
fewer steps for the user, which §2 asks for when a task is ambiguous.

The public name is still asked for explicitly, prefilled and editable, rather
than copied from the profile. `profiles.display_name` is private and
`instructors.display_name` is public; that split is the whole of 0004, and
silently promoting one to the other would publish a name the person never agreed
to show. Once the instructor row exists its name is authoritative and the field
disappears.

Unverified instructors can publish. That is a v1 product decision — nothing gates
on `verified`, and the flag continues to mean "we have checked this person",
never "this person may act". It is still unsettable by its owner (0004).

## RLS as a backstop, not as a query filter

The sharpest lesson of this phase, and the reason it is written down.

`findOwnInstructor` was first written with no `WHERE`, on the assumption that RLS
would narrow it to the caller — the way it genuinely does for `profiles`. It does
not: `instructors_select_public` is `using (true)`, because the map has to name
who runs a dance for a visitor with no account. The unfiltered read returned
*another* instructor's row, and a brand-new user was shown a stranger's public
name and told they were already registered.

The write would still have been refused — `dance_events_insert_own` checks
`owns_instructor` — which is the defence in depth §8 asks for, and exactly why
"RLS will catch it" is not a licence to query loosely. Ownership is now filtered
in the query on both tables, and `tests/rls/publishDance.test.ts` pins the
underlying behaviour so nobody removes the filter believing it redundant.

## Publishing is atomic, through one RPC

Publishing writes a `dance_events` row and one `event_occurrences` row. Migration
0006 does both inside `public.publish_dance`, so PostgREST wraps them in a single
transaction and a failure on either rolls back both.

### Correction — the first version of this ADR was wrong

This section originally described the two-call version (insert, insert,
compensating delete on failure) and dismissed the residual orphan as "a
`dance_events` row that no read path can reach… invisible rather than wrong."

**That was incorrect, and it was incorrect in the direction that matters.** The
reasoning only considered *our* read paths, all of which join through
occurrences. It ignored the fact that `anon` holds SELECT on `dance_events` and
that `dance_events_select_public` is `using (true)` — so PostgREST serves the
table directly at `/rest/v1/dance_events` to a caller with no account. Confirmed
against the local stack: an event inserted on its own came straight back to an
anonymous GET, with an empty occurrence list beside it.

So a half-published dance was never invisible. It was a publicly readable row
asserting that a named instructor runs a dance at a named venue, with no night
attached and nothing to tell a reader that anything was missing. "No screen of
ours renders it" is not the same as "nobody can read it", and on a table anon can
select from, the second is the only claim worth making.

### What the RPC does and does not do

`publish_dance` is **SECURITY INVOKER**. It runs as the caller, so both inserts
are still checked by the policies that already existed —
`dance_events_insert_own` (`owns_instructor`) and `event_occurrences_insert_own`
(`owns_event`). Nothing in the function re-implements an ownership rule; a second
copy is a copy that can drift from the one protecting every other write path.

A DEFINER version would have run as the table owner with RLS switched off around
it, turning a convenience function into a hole through every ownership policy in
the schema, callable by any signed-in user with an `instructor_id` of their
choosing. The gap between the two keywords is the entire security design here.

`owns_event()` has to see the event the previous statement just inserted, and it
does: it is `stable`, so it reads the calling statement's snapshot, which in
read-committed includes earlier commands in the same transaction. Verified rather
than assumed — a publish that reaches step two at all is that proof, since the
occurrence insert would otherwise fail its `WITH CHECK`.

EXECUTE is granted to `authenticated` only. `CREATE FUNCTION` grants it to
`PUBLIC` by default, so the migration revokes that first; `service_role` loses it
along with everyone else, deliberately, because it bypasses RLS and would turn an
invoker function into an unchecked one.

Measured after the change: an occurrence that violates
`event_occurrences_ends_after_starts` returns 23514 and leaves the
`dance_events` count unchanged when read as `anon`. `anon` calling the function
gets 42501, "permission denied for function publish_dance".

## Wall-clock time in, UTC out

`src/lib/domain/jerusalemTime.ts` is the inverse of `occurrenceTime.ts`, which
had said out loud that the day we need arithmetic is the day we need a real date
library. We do not: the module asks `Intl` what Israel's offset **was at a
specific instant** and subtracts it. That is a lookup against the tz database,
not an interval computed across a boundary, so no dependency was added (§13) and
no transition dates are hardcoded — Israel's DST rule has been changed by the
Knesset before.

Two edges are handled deliberately:

- **The spring-forward gap is rejected**, not nudged. 02:30 does not exist on the
  night the clocks jump 02:00 → 03:00, and silently moving a dance an hour is the
  AGENTS.md §10 failure — the instructor believes one time and every dancer is
  told another.
- **An evening that ends past midnight rolls to the next calendar day.**
  21:00–00:30 is an ordinary הרקדה, not a negative duration. A twelve-hour ceiling
  keeps that reading from turning a 20:00–19:00 typo into a 23-hour dance.

Verified end to end against the local stack: an evening entered as 20:30–00:30 on
2026-08-17 stored as `2026-08-17T17:30Z` → `2026-08-18T00:30` Israel local, and
surfaced to an anonymous visitor through both `find_dances_near` and the schedule.
