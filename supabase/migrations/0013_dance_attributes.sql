-- 0013 — dance attributes: level, formation types, and women-only, plus the
-- filter surfaces that read them.
--
-- 0001, 0006, 0009 and 0012 are already applied and are not edited here
-- (AGENTS.md §12 / §13).
--
-- Phase 4.6b. Three new dance_events columns, set by the instructor at publish
-- time, public-readable like every other dance_events column, and returned by
-- find_dances_near / find_favorite_nights so the map and schedule can filter
-- and display them.
--
-- ---------------------------------------------------------------------------
-- Part 1 — the columns
-- ---------------------------------------------------------------------------
--
-- LEVEL is single-valued: a dance runs at one level, never several at once, so
-- a scalar enum is the honest shape rather than a one-element array.
--
-- TYPES is genuinely multi — a night can be circles AND couples — so it is a
-- closed-set enum ARRAY, not the existing `dance_types text[]` column. That
-- column is free text, has no owner-scoped write path, and nothing in the read
-- path has ever displayed it (confirmed: `MapDance` never carries it). It is
-- left untouched here — repurposing a column that already ships to `anon`
-- under a different implied meaning is a bigger, riskier change than adding a
-- new one, and cleaning up unused legacy data is its own task, not this one.
-- The new column is named `dance_formations` to say plainly what these four
-- values are — how the dancers are arranged — and avoid colliding with the
-- name `dance_types` already in use for something else.
--
-- WOMEN_ONLY is a plain boolean, default false: "not stated" and "not
-- women-only" are the same thing for this attribute, unlike venues.has_parking
-- et al. (migration 0001), where "we don't know" has to be distinguishable
-- from "no". A dance either says הרקדה לנשים בלבד or it does not.
create type public.dance_level as enum ('beginner', 'intermediate', 'advanced', 'all_levels');

comment on type public.dance_level is
  'A dance''s level (Phase 4.6b): מתחילים / בינוני / מתקדמים / כל הרמות. English identifiers, Hebrew labels live in src/lib/i18n/he.ts — same convention as public.avatar_choice (migration 0011) and public.occurrence_status (migration 0001).';

create type public.dance_formation as enum ('circle', 'couples', 'line', 'mixed');

comment on type public.dance_formation is
  'How the dancers are arranged (Phase 4.6b): מעגלים / זוגות / ליין / מעורב. A dance can be more than one, hence dance_events.dance_formations is an ARRAY of this type, not a scalar.';

alter table public.dance_events
  add column level public.dance_level not null default 'all_levels',
  add column dance_formations public.dance_formation[] not null default '{}'
    check (array_position(dance_formations, null) is null),
  add column women_only boolean not null default false;

comment on column public.dance_events.level is
  'The dance''s level. NOT NULL with a default, like avatar_id (migration 0011): "no level chosen" is not a state this product needs, every dance publishes as כל הרמות unless the instructor says otherwise. Public-readable: dance_events_select_public (migration 0001) already covers every column.';

comment on column public.dance_events.dance_formations is
  'Closed-set, multi-valued (מעגלים / זוגות / ליין / מעורב). Defaults to empty — "not specified" — rather than to a value, unlike level: there is no single formation that is the honest default the way כל הרמות is for level. Deliberately separate from the legacy free-text dance_types column; see this migration''s header.';

comment on column public.dance_events.women_only is
  'הרקדה לנשים בלבד. Plain boolean, default false — unlike venues.has_parking et al., there is no "unknown" state to preserve here.';

-- ---------------------------------------------------------------------------
-- Part 2 — the write path: instructor sets these at publish time
-- ---------------------------------------------------------------------------
--
-- No new grant. dance_events has carried a TABLE-WIDE insert/update grant to
-- `authenticated` since migration 0001 — unlike instructors/profiles, this
-- table's write boundary has always been ownership (dance_events_insert_own /
-- dance_events_update_own, both `owns_instructor(instructor_id)`) plus CHECK
-- constraints, not per-column grants. Migration 0009 restates this explicitly
-- ("authenticated holds a plain UPDATE grant on this table and can therefore
-- write these columns without going through the RPC") when it added the
-- recurrence_* columns, and tests/rls/rls.test.ts asserts an instructor can
-- already rewrite `price_agorot` directly. A column-scoped grant on just these
-- three new columns would not match that design, and narrowing the table-wide
-- grant now would break that existing, intentional, tested behaviour. So the
-- three new columns get exactly the same table-wide-grant-plus-ownership-RLS
-- boundary every other dance_events column already has — which already
-- satisfies "an instructor writes these only on their own event" (RLS USING)
-- and "a non-owner cannot write them at all" (RLS denies, same as it denies a
-- non-owner's price_agorot write today). See docs/decisions/0023 for the full
-- reasoning and why this deliberately diverges from the column-scoped-grant
-- pattern migration 0011 used for profiles.avatar_id.
--
-- What DOES need a migration: publish_dance and publish_recurring_dance take a
-- fixed parameter list, and the form sets these three attributes in the same
-- transaction as the rest of the dance rather than in a second write. Both are
-- DROPped and re-created — not CREATE OR REPLACE — because adding parameters
-- changes the signature; CREATE OR REPLACE would create a second, overloaded
-- function and leave the four/seven-argument original in place rather than
-- replacing it (the same class of restriction 0012's header describes for a
-- RETURNS TABLE change, here on the input side instead).
--
-- Every new parameter defaults to this column's own table default, so a caller
-- that does not know about them — there should be none after this migration,
-- but belt and suspenders — gets exactly what an omitted column would have.
drop function public.publish_dance(uuid, uuid, timestamptz, timestamptz);

create function public.publish_dance(
  p_instructor_id uuid,
  p_venue_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_level public.dance_level default 'all_levels',
  p_dance_formations public.dance_formation[] default '{}',
  p_women_only boolean default false
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
  insert into public.dance_events (
    instructor_id, venue_id, price_agorot, level, dance_formations, women_only
  )
  values (
    p_instructor_id, p_venue_id, 0, p_level, p_dance_formations, p_women_only
  )
  returning id into v_event_id;

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

comment on function public.publish_dance(uuid, uuid, timestamptz, timestamptz, public.dance_level, public.dance_formation[], boolean) is
  'Publishes one non-recurring dance and its single night in one transaction (migration 0006), now also recording level/dance_formations/women_only in the same insert. SECURITY INVOKER — ownership is dance_events_insert_own and event_occurrences_insert_own, not re-implemented here.';

revoke all on function public.publish_dance(uuid, uuid, timestamptz, timestamptz, public.dance_level, public.dance_formation[], boolean)
  from public, anon;

grant execute on function public.publish_dance(uuid, uuid, timestamptz, timestamptz, public.dance_level, public.dance_formation[], boolean)
  to authenticated;

drop function public.publish_recurring_dance(uuid, uuid, public.recurrence_freq, date, time, time, date);

create function public.publish_recurring_dance(
  p_instructor_id uuid,
  p_venue_id uuid,
  p_freq public.recurrence_freq,
  p_start_date date,
  p_local_start_time time,
  p_local_end_time time,
  p_until_date date default null,
  p_level public.dance_level default 'all_levels',
  p_dance_formations public.dance_formation[] default '{}',
  p_women_only boolean default false
)
returns table (event_id uuid, occurrence_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_count integer;
begin
  if p_freq is null then
    raise exception 'p_freq is required; publish a single night with publish_dance';
  end if;

  insert into public.dance_events (
    instructor_id,
    venue_id,
    price_agorot,
    recurrence_freq,
    recurrence_start_date,
    recurrence_until_date,
    recurrence_local_start_time,
    recurrence_local_end_time,
    level,
    dance_formations,
    women_only
  )
  values (
    p_instructor_id,
    p_venue_id,
    0,
    p_freq,
    p_start_date,
    p_until_date,
    p_local_start_time,
    p_local_end_time,
    p_level,
    p_dance_formations,
    p_women_only
  )
  returning id into v_event_id;

  v_count := public.generate_occurrences_for_event(v_event_id);

  if v_count = 0 then
    raise exception
      'this series materialises no nights between today and the horizon'
      using errcode = 'P0001';
  end if;

  return query select v_event_id, v_count;
end;
$$;

comment on function public.publish_recurring_dance(uuid, uuid, public.recurrence_freq, date, time, time, date, public.dance_level, public.dance_formation[], boolean) is
  'Publishes a recurring dance and its first horizon of nights in one transaction (migration 0009), now also recording level/dance_formations/women_only. SECURITY INVOKER: ownership is dance_events_insert_own and event_occurrences_insert_own.';

revoke all on function public.publish_recurring_dance(uuid, uuid, public.recurrence_freq, date, time, time, date, public.dance_level, public.dance_formation[], boolean)
  from public, anon;

grant execute on function public.publish_recurring_dance(uuid, uuid, public.recurrence_freq, date, time, time, date, public.dance_level, public.dance_formation[], boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Part 3 — the read path: find_dances_near / find_favorite_nights gain the
-- three columns
-- ---------------------------------------------------------------------------
--
-- DROP and CREATE, same reason 0012 gives: Postgres refuses to CREATE OR
-- REPLACE a set-returning function whose result columns changed. Every guard
-- from 0003/0012 — the 50km radius clamp, the 60-day horizon, the 200-row
-- limit, the lat/lng/radius validation, the no-status-filter stance — is
-- carried across unchanged; only the SELECT list and RETURNS TABLE grow.
drop function public.find_dances_near(double precision, double precision, double precision);

create function public.find_dances_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision
)
returns table (
  event_id uuid,
  occurrence_id uuid,
  starts_at timestamptz,
  original_starts_at timestamptz,
  status public.occurrence_status,
  venue_id uuid,
  venue_name text,
  venue_lat double precision,
  venue_lng double precision,
  instructor_display_name text,
  dance_types text[],
  price_agorot integer,
  level public.dance_level,
  dance_formations public.dance_formation[],
  women_only boolean
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
      e.id as event_id,
      o.id as occurrence_id,
      o.starts_at,
      o.original_starts_at,
      o.status,
      v.id as venue_id,
      v.name as venue_name,
      extensions.st_y(v.location::extensions.geometry) as venue_lat,
      extensions.st_x(v.location::extensions.geometry) as venue_lng,
      i.display_name as instructor_display_name,
      e.dance_types,
      e.price_agorot,
      e.level,
      e.dance_formations,
      e.women_only
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
  'The public map''s proximity query (AGENTS.md §9). Radius clamped to 50km, 200-row cap, 60-day horizon (migration 0003); event_id (0012). Phase 4.6b adds level/dance_formations/women_only for the map/schedule filters — no new guard, they are read off the same joined row.';

revoke all on function public.find_dances_near(double precision, double precision, double precision) from public;
grant execute on function public.find_dances_near(double precision, double precision, double precision) to anon, authenticated;

drop function public.find_favorite_nights(uuid[]);

create function public.find_favorite_nights(
  p_event_ids uuid[]
)
returns table (
  event_id uuid,
  occurrence_id uuid,
  starts_at timestamptz,
  original_starts_at timestamptz,
  status public.occurrence_status,
  venue_id uuid,
  venue_name text,
  venue_lat double precision,
  venue_lng double precision,
  instructor_display_name text,
  dance_types text[],
  price_agorot integer,
  level public.dance_level,
  dance_formations public.dance_formation[],
  women_only boolean
)
language plpgsql
stable
set search_path = ''
as $$
declare
  c_horizon interval := interval '60 days';
  c_row_limit constant integer := 200;
begin
  if p_event_ids is null or array_length(p_event_ids, 1) is null then
    return;
  end if;

  return query
    select
      e.id as event_id,
      o.id as occurrence_id,
      o.starts_at,
      o.original_starts_at,
      o.status,
      v.id as venue_id,
      v.name as venue_name,
      extensions.st_y(v.location::extensions.geometry) as venue_lat,
      extensions.st_x(v.location::extensions.geometry) as venue_lng,
      i.display_name as instructor_display_name,
      e.dance_types,
      e.price_agorot,
      e.level,
      e.dance_formations,
      e.women_only
    from public.event_occurrences o
    join public.dance_events e on e.id = o.event_id
    join public.venues v on v.id = coalesce(o.override_venue_id, e.venue_id)
    join public.instructors i on i.id = e.instructor_id
    where e.id = any (p_event_ids)
      and o.starts_at >= now()
      and o.starts_at < now() + c_horizon
    order by o.starts_at
    limit c_row_limit;
end;
$$;

comment on function public.find_favorite_nights(uuid[]) is
  'The "my favorites" list on /profile (migration 0012) — find_dances_near''s sibling, filtered by event id. Phase 4.6b adds level/dance_formations/women_only, same as find_dances_near.';

revoke all on function public.find_favorite_nights(uuid[]) from public;
grant execute on function public.find_favorite_nights(uuid[]) to authenticated;
