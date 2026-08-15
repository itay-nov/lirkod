-- 0012 — favorites: a signed-in dancer's saved dances.
--
-- Phase 4.5. Three things, in one migration because the second and third only
-- exist to serve the first:
--
--   Part 1  public.favorites — the table itself, RLS, grants.
--   Part 2  find_dances_near gains event_id, so a client can favorite the
--           SERIES a map pin or schedule row belongs to, not just the one
--           night it happens to be looking at (docs/decisions/0002 — a night
--           is a materialized row, but the thing a dancer saves is the
--           recurring dance).
--   Part 3  find_favorite_nights — find_dances_near's sibling, filtered by a
--           set of event ids instead of by distance, for the "my favorites"
--           list on /profile.
--
-- ---------------------------------------------------------------------------
-- Part 1 — public.favorites
-- ---------------------------------------------------------------------------
--
-- Keyed on the SERIES (dance_events), not the occurrence: favoriting "the
-- Tuesday dance at בית ציוני אמריקה" has to keep meaning that as new nights
-- are generated ahead of it (migration 0009) — favoriting one materialized
-- occurrence row would go stale the moment that specific night passed.
--
-- user_id both DEFAULTs to auth.uid() and is checked by
-- favorites_insert_own's WITH CHECK below. The WITH CHECK is the actual
-- enforcement — RLS is what a client posting straight to PostgREST with the
-- anon key cannot get around (AGENTS.md §8, and this project's own history
-- with dead grants — see migration 0011). The DEFAULT is the belt: a caller
-- that follows the obvious shape of an insert (naming only event_id, the way
-- profiles_insert_own's callers are not required to think about `id`) gets
-- the right value without having to know to supply it, and never gets the
-- chance to name a different one instead.
--
-- references auth.users, not public.profiles, on purpose — unlike
-- instructors.profile_id. A profile row only exists once someone has
-- answered "what's your name" (migration 0001's NOT NULL display_name), and
-- favoriting is reachable from the map and schedule, which nothing requires
-- a fresh sign-in to have visited first. Requiring a profiles row here would
-- make a dancer who signed in but has not yet named themselves unable to
-- save a dance, for a reason that has nothing to do with favorites.
--
-- No UPDATE column: a favorite is added or removed, never edited in place.
create table public.favorites (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  event_id uuid not null references public.dance_events (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- The UNIQUE constraint the task asks for, and the PRIMARY KEY get it for
  -- free: a second favorite of the same dance by the same user is a
  -- constraint violation, which addFavorite (src/lib/db/favorites.ts) turns
  -- into a silent no-op via upsert(..., { ignoreDuplicates: true }) rather
  -- than an error a dancer would ever see.
  primary key (user_id, event_id)
);

comment on table public.favorites is
  'A signed-in dancer''s saved dances (Phase 4.5), keyed on the SERIES (dance_events), not a single night. Private — no anon or public read, ever. See migration''s own header for why user_id references auth.users rather than public.profiles.';

comment on column public.favorites.user_id is
  'Defaults to auth.uid(); favorites_insert_own additionally REQUIRES it via WITH CHECK. Together these mean a client cannot insert a favorite under anyone else''s id, whether or not it bothers to send the column at all.';

-- The FK to dance_events has no index of its own — PRIMARY KEY (user_id,
-- event_id) does not cover lookups by event_id alone, which both the
-- ON DELETE CASCADE (when an instructor's dance is removed) and
-- find_favorite_nights' filter need.
create index favorites_event_id_idx on public.favorites (event_id);

-- ---------------------------------------------------------------------------
-- RLS — own-row only, no anon policy at all (AGENTS.md §8)
-- ---------------------------------------------------------------------------

alter table public.favorites enable row level security;

-- Allows: a signed-in user to read their own favorites, and only their own.
-- Denies: every anonymous read (no policy `to anon` exists on this table at
-- all — not even a narrowed one), and reading anyone else's favorites.
-- Favorites are private this phase: no "N people favorited this" aggregate,
-- per the task this migration answers.
create policy "favorites_select_own"
  on public.favorites for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Allows: a signed-in user to favorite a dance under their own id.
-- Denies: favoriting a dance attributed to another user id — the actual
-- enforcement behind the DEFAULT above.
create policy "favorites_insert_own"
  on public.favorites for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Allows: a signed-in user to remove their own favorite.
-- Denies: removing anyone else's favorite. A delete that matches no row
-- (unfavoriting something already not favorited, or someone else's row) is
-- not an error — see the note on removeFavorite in src/lib/db/favorites.ts.
create policy "favorites_delete_own"
  on public.favorites for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- No update policy: nothing in this table is ever edited in place.

grant all on public.favorites to service_role;

-- No grant to anon at all, unlike every other table in this schema — this is
-- the one table AGENTS.md §2.2's "auth only for actions that need identity"
-- actually reaches for: reading it is itself the personal data, so there is
-- no "read is the product, writes are gated" split to make here.
grant select, insert, delete on public.favorites to authenticated;

-- ---------------------------------------------------------------------------
-- Part 2 — find_dances_near gains event_id
-- ---------------------------------------------------------------------------
--
-- DROP and CREATE rather than CREATE OR REPLACE, same reason migration 0010
-- gives: Postgres refuses to replace a set-returning function whose result
-- columns changed, and this adds one. Everything else — the 50km clamp, the
-- 60-day horizon, the 200-row limit, the lat/lng validation, the re-timed
-- flag from 0010, the SECURITY INVOKER stance — is carried across unchanged.
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
  'The public map''s proximity query (AGENTS.md §9). Does not filter by status — a cancelled, moved or re-timed night must still reach an anonymous visitor (AGENTS.md §2.6, §10). Radius clamped to 50km, 200-row cap, 60-day horizon. event_id (Phase 4.5) is what a client favorites — the series, not the occurrence.';

revoke all on function public.find_dances_near(double precision, double precision, double precision) from public;
grant execute on function public.find_dances_near(double precision, double precision, double precision) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Part 3 — find_favorite_nights: find_dances_near's sibling, filtered by
-- event id instead of by distance
-- ---------------------------------------------------------------------------
--
-- Exists for the same reason find_dances_near is an RPC at all
-- (docs/decisions/0005): PostgREST cannot express
-- coalesce(override_venue_id, dance_events.venue_id) as a join, and the "my
-- favorites" list on /profile needs that same coalesce, the same instructor
-- name join, and the same shape src/lib/db/dances.ts already knows how to
-- turn into a NearbyDance — so this returns exactly find_dances_near's
-- columns, letting both RPCs share one TypeScript mapper.
--
-- Does not filter by status either, for the same reason and the same
-- AGENTS.md §10 requirement: a favorited dance that got cancelled is the
-- one thing a follower most needs to still see, not an occurrence that
-- silently disappears from their list.
--
-- Granted to `authenticated` only, though nothing here actually depends on
-- who is asking — event_occurrences_select_public and
-- dance_events_select_public are both `using (true)`, so this discloses
-- nothing an anonymous caller could not already read directly. The
-- restriction is "this is a signed-in feature" by convention, not a
-- confidentiality boundary; the actual privacy boundary is that a caller
-- can only ever learn ITS OWN event ids to pass in, which is
-- favorites_select_own's job, not this function's.
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
  price_agorot integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  c_horizon interval := interval '60 days';
  c_row_limit constant integer := 200;
begin
  -- A null or empty array is "no favorites yet", not "every dance" — `= any`
  -- against an empty array is false for every row, so this needs no special
  -- case, but the guard makes the intent explicit rather than relying on
  -- that behaviour silently.
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
      e.price_agorot
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
  'The "my favorites" list on /profile (Phase 4.5) — find_dances_near''s sibling, filtered by event id rather than distance. Same shape, same 60-day horizon and 200-row cap, same no-status-filter stance (AGENTS.md §10). See this migration''s Part 3 header for why authenticated-only is convention rather than a confidentiality boundary.';

revoke all on function public.find_favorite_nights(uuid[]) from public;
grant execute on function public.find_favorite_nights(uuid[]) to authenticated;
