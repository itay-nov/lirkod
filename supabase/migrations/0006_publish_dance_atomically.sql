-- 0006 — publish a dance and its night in ONE transaction.
--
-- 0001 is already applied and is not edited here (AGENTS.md §12 / §13).
--
-- The gap this closes. Publishing was two PostgREST calls — insert dance_events,
-- then insert event_occurrences — with a compensating delete if the second
-- failed. Two calls are two transactions, so a process death between them left a
-- dance_events row with no night.
--
-- docs/decisions/0014 called that orphan "invisible rather than wrong", on the
-- reasoning that every read path joins through occurrences. That reasoning was
-- wrong, and the ADR has been corrected. `anon` holds SELECT on dance_events and
-- `dance_events_select_public` is `using (true)`, so PostgREST serves the row
-- straight out of /rest/v1/dance_events to someone with no account at all.
-- Confirmed against this stack before writing this migration: an event inserted
-- on its own came back to an anonymous GET, with an empty occurrence list beside
-- it. A half-published dance is not a hidden bookkeeping artefact; it is a
-- publicly readable row asserting that an instructor runs a dance at a venue,
-- with no night attached and no way for a dancer to see that anything is missing.
--
-- The fix is to make the pair atomic rather than to hide the wreckage. PostgREST
-- wraps a single RPC call in one transaction, so if the occurrence insert raises
-- — a constraint, a policy, anything — the event insert rolls back with it and
-- there is nothing left to read.

-- SECURITY INVOKER, stated explicitly rather than left to the default, because it
-- is the whole security design of this function.
--
-- It runs as the CALLER, so both inserts are checked by the policies already on
-- those tables: dance_events_insert_own (owns_instructor) and
-- event_occurrences_insert_own (owns_event). Nothing here re-implements those
-- checks. A second copy of an ownership rule is a copy that can disagree with the
-- original, and the original is the one that also protects every other write path.
--
-- A SECURITY DEFINER version of this function would run as the table owner, RLS
-- would not apply to it at all, and it would become a hole straight through every
-- ownership policy in the schema — reachable by any signed-in user, with an
-- instructor_id of their choosing. That is the opposite of what is wanted, and it
-- is the reason this comment is longer than the function.
--
-- search_path is pinned to '' so every reference has to be schema-qualified and
-- the function cannot be captured by a caller's search_path — the same treatment
-- owns_instructor and owns_event already get in 0001.
create or replace function public.publish_dance(
  p_instructor_id uuid,
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns table (event_id uuid, occurrence_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_occurrence_id uuid;
begin
  -- price_agorot is NOT NULL with no default and pricing is out of scope for this
  -- phase, so every dance published here records zero. A placeholder, NOT a claim
  -- that the dance is free — whoever builds pricing has to be able to tell "we
  -- never asked" from "the instructor said it costs nothing", and adding the
  -- parameter is their migration to write.
  insert into public.dance_events (instructor_id, venue_id, recurrence_rule, price_agorot)
  values (p_instructor_id, p_venue_id, null, 0)
  returning id into v_event_id;

  -- owns_event() is consulted by the policy on THIS insert and has to see the row
  -- the statement above just wrote. It does: the function is stable, so it reads
  -- the snapshot of the calling statement, which in read-committed includes every
  -- earlier command in the same transaction. Verified on this stack rather than
  -- assumed — if it did not hold, this insert would fail its WITH CHECK and take
  -- the event down with it, which is a loud failure rather than a silent one.
  --
  -- override_venue_id stays null: an override on a scheduled night is the one
  -- combination 0001's check constraint makes unrepresentable, because it is how
  -- a dancer ends up at a dark hall (docs/decisions/0003).
  insert into public.event_occurrences (event_id, starts_at, ends_at, status, override_venue_id)
  values (
    v_event_id,
    p_starts_at,
    p_ends_at,
    'scheduled'::public.occurrence_status,
    null
  )
  returning id into v_occurrence_id;

  return query select v_event_id, v_occurrence_id;
end;
$$;

comment on function public.publish_dance(uuid, uuid, timestamptz, timestamptz) is
  'Publishes one non-recurring dance and its single night in one transaction, so a failure leaves no orphaned dance_events row (docs/decisions/0014). SECURITY INVOKER on purpose: ownership is enforced by dance_events_insert_own and event_occurrences_insert_own, not re-implemented here.';

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, so the revoke is not
-- decoration — without it `anon` could call this, and while RLS would still
-- refuse both inserts, an unauthenticated caller has no business reaching a
-- publishing entry point at all.
--
-- service_role is inside PUBLIC and therefore loses it too. That is deliberate:
-- it bypasses RLS, so a server-side caller holding it would turn an invoker
-- function into an unchecked one. A future server job that needs to publish
-- should insert into the tables directly, where its intent is visible.
revoke all on function public.publish_dance(uuid, uuid, timestamptz, timestamptz)
  from public, anon;

grant execute on function public.publish_dance(uuid, uuid, timestamptz, timestamptz)
  to authenticated;
