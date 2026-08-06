-- 0002 — find_dances_near: the first real domain query.
--
-- AGENTS.md §9: proximity filtering runs in Postgres via ST_DWithin, never
-- fetch-then-filter in JS. Exposed as a SQL function rather than a view because a
-- night's venue is coalesce(occurrence.override_venue_id, dance_events.venue_id)
-- (docs/decisions/0003) and PostgREST's query builder cannot express that coalesce
-- as part of a join on its own — see docs/decisions/0005.
--
-- No explicit `security invoker` — that is the default for a plain `create function`,
-- named here because it is load-bearing: the function runs with the caller's own
-- privileges and RLS, exactly as if `anon` had issued the underlying selects
-- directly. It needs no elevated access, because every table it reads is already
-- public-select per migration 0001.

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
language sql
stable
set search_path = ''
as $$
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
    and extensions.st_dwithin(
      v.location,
      extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
      p_radius_meters
    )
  order by o.starts_at;
$$;

comment on function public.find_dances_near(double precision, double precision, double precision) is
  'The public map''s proximity query (AGENTS.md §9). Does not filter by status — a cancelled or moved night must still reach an anonymous visitor, with its status, so the UI can render the required label (AGENTS.md §2.6, §10).';

-- anon needs this for the map to work with no account (AGENTS.md §2.1-2.2).
revoke all on function public.find_dances_near(double precision, double precision, double precision) from public;
grant execute on function public.find_dances_near(double precision, double precision, double precision) to anon, authenticated;
