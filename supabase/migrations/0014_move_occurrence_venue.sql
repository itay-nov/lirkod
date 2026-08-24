-- 0014 — move ONE published night to a different venue.
--
-- The recurring series keeps its usual venue on dance_events.venue_id. This
-- function changes only event_occurrences.override_venue_id, matching the
-- per-night cancel/re-time model from migration 0010 and the precedence rule in
-- docs/decisions/0003. The recurrence generator therefore keeps its rule and
-- every other materialised night stays at the series venue.
--
-- SECURITY INVOKER is the security boundary here: the UPDATE runs as the caller
-- and is filtered by event_occurrences_update_own, whose USING/WITH CHECK both
-- call owns_event(event_id). There is deliberately no second ownership test in
-- this function that could drift from the policy protecting direct PostgREST
-- writes.
--
-- The venue itself already passed the same database boundary used at publish:
-- public.venues enforces trimmed non-empty name/address, the migration 0008
-- length ceilings and Israel coordinate bounds, while find_or_create_venue
-- provides place_id dedupe. This function accepts only a venue FK, so it cannot
-- create a less-validated venue through a second path. A nonexistent id is
-- rejected by event_occurrences_override_venue_id_fkey.

create function public.move_occurrence_venue(
  p_occurrence_id uuid,
  p_venue_id uuid
)
returns table (occurrence_id uuid)
language sql
security invoker
set search_path = ''
as $$
  update public.event_occurrences o
  set
    override_venue_id = case
      when p_venue_id = e.venue_id then null
      else p_venue_id
    end,
    status = case
      -- A cancelled night stays cancelled. Its effective venue may still be
      -- corrected without telling dancers that the dance is back on.
      when o.status = 'cancelled' then 'cancelled'::public.occurrence_status
      when p_venue_id = e.venue_id then 'scheduled'::public.occurrence_status
      else 'moved'::public.occurrence_status
    end
  from public.dance_events e
  where o.id = p_occurrence_id
    and e.id = o.event_id
  returning o.id;
$$;

comment on function public.move_occurrence_venue(uuid, uuid) is
  'Moves one materialised occurrence to a venue that already passed the shared venues CHECK constraints, or clears the override when the series venue is selected. SECURITY INVOKER: event_occurrences_update_own/owns_event remains the ownership authority.';

revoke all on function public.move_occurrence_venue(uuid, uuid)
  from public, anon;

grant execute on function public.move_occurrence_venue(uuid, uuid)
  to authenticated;
