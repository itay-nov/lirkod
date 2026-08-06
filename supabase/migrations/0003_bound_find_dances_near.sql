-- 0003 — bound find_dances_near: cap radius, add a time horizon and a row limit,
-- validate lat/lng.
--
-- 0002 is already applied and is not edited here (AGENTS.md §12 / §13). This
-- `create or replace`s the same function signature with server-side bounds: an
-- anonymous, unbounded radius on a public RPC let a single call return the entire
-- future event_occurrences table (confirmed locally with a 1,000,000km radius) —
-- a resource-abuse vector, and a contradiction of the map's performance budget
-- (AGENTS.md §9).
--
-- Choices, and why:
--
--   * radius is CLAMPED to a maximum (50km), not rejected. A caller asking for
--     "everything nearby" with an oversized radius has not sent malformed input, just
--     an oversized request — clamping keeps the query working and returns the closest
--     matches instead of an error. 50km is several times the seeded Holon<->Tel Aviv
--     gap and already a long drive for a single dance; nothing in AGENTS.md calls for
--     a bigger search radius than that.
--   * radius <= 0 is REJECTED, not clamped upward — that is not "give me more
--     results", it is a malformed request. Silently reinterpreting it would hide a
--     client bug behind a query the caller never asked for.
--   * lat/lng outside the valid geographic range are REJECTED, not clamped. Unlike
--     radius there is no sane "nearest valid" value to clamp a bad coordinate to —
--     clamping -100 to -90 would silently query a real but wrong location instead of
--     surfacing the caller's bug. NULL inputs are rejected the same way.
--   * a 60-day time horizon and a 200-row LIMIT bound the result set independently of
--     radius, so a dense area — or a future radius increase — still cannot return an
--     unbounded number of rows. This 60 days is a cap on THIS read only; it is not a
--     decision about how far ahead the occurrence generator materializes rows, which
--     is still an open question in docs/decisions/0002.
--
-- language plpgsql (not sql, unlike 0002) because validation needs RAISE, which a
-- language sql function body cannot express.

create or replace function public.find_dances_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision
)
returns table (
  occurrence_id uuid,
  starts_at timestamptz,
  status public.occurrence_status,
  venue_id uuid,
  venue_name text,
  venue_lat double precision,
  venue_lng double precision,
  instructor_display_name text,
  dance_types text[],
  price_agorot integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  c_max_radius_meters constant double precision := 50000;
  c_horizon interval := interval '60 days';
  c_row_limit constant integer := 200;
  v_radius double precision;
begin
  if p_lat is null or p_lng is null or p_radius_meters is null then
    raise exception 'p_lat, p_lng, and p_radius_meters are all required';
  end if;

  -- `not between` (rather than `< -90 or > 90`) also catches NaN: every comparison
  -- against NaN is false, so `NaN between -90 and 90` is false and `not` makes this
  -- true, same as a genuinely out-of-range value.
  if p_lat not between -90 and 90 then
    raise exception 'p_lat must be between -90 and 90, got %', p_lat;
  end if;
  if p_lng not between -180 and 180 then
    raise exception 'p_lng must be between -180 and 180, got %', p_lng;
  end if;
  if p_radius_meters <= 0 then
    raise exception 'p_radius_meters must be positive, got %', p_radius_meters;
  end if;

  v_radius := least(p_radius_meters, c_max_radius_meters);

  return query
    select
      o.id as occurrence_id,
      o.starts_at,
      o.status,
      v.id as venue_id,
      v.name as venue_name,
      extensions.st_y(v.location::extensions.geometry) as venue_lat,
      extensions.st_x(v.location::extensions.geometry) as venue_lng,
      i.display_name as instructor_display_name,
      e.dance_types,
      e.price_agorot
    from public.event_occurrences o
    join public.dance_events e on e.id = o.event_id
    join public.venues v on v.id = coalesce(o.override_venue_id, e.venue_id)
    join public.instructors i on i.id = e.instructor_id
    where o.starts_at >= now()
      and o.starts_at < now() + c_horizon
      and extensions.st_dwithin(
        v.location,
        extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
        v_radius
      )
    order by o.starts_at
    limit c_row_limit;
end;
$$;

comment on function public.find_dances_near(double precision, double precision, double precision) is
  'The public map''s proximity query (AGENTS.md §9). Does not filter by status — a cancelled or moved night must still reach an anonymous visitor, with its status, so the UI can render the required label (AGENTS.md §2.6, §10). Radius is clamped to 50km, results are capped at 200 rows within a 60-day horizon, and invalid lat/lng/radius are rejected — see the migration header for why each choice is a clamp vs. a rejection.';

-- Restated even though CREATE OR REPLACE preserves the prior ACL, so this migration
-- is self-contained and the grant doesn't silently depend on 0002 having run first.
revoke all on function public.find_dances_near(double precision, double precision, double precision) from public;
grant execute on function public.find_dances_near(double precision, double precision, double precision) to anon, authenticated;
