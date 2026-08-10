-- 0007 — let a signed-in user add a venue, once, from a Google Place.
--
-- 0001 and 0004 are already applied and are not edited here (AGENTS.md §12 / §13).
--
-- Until now `venues` was curated: `authenticated` held SELECT and nothing else,
-- and every row arrived through service_role. 3.2b makes it self-service, because
-- an instructor whose hall is not in our three seeded rows currently cannot
-- publish at all.
--
-- Three things have to be true for that to be safe rather than merely possible:
--
--   1. Only a signed-in caller may insert. `anon` gets nothing new — it keeps
--      SELECT, which the map depends on (AGENTS.md §2.1).
--   2. A venue may only be added as a REAL PLACE. Every insert has to carry a
--      Google place_id, so a venue is something that exists in the world rather
--      than free text somebody typed.
--   3. The same place may exist at most once. Duplicate halls are how a venue
--      list becomes useless, and dedupe has to be enforced by the database
--      rather than by a check-then-insert in application code that two
--      concurrent callers can both pass.
--
-- What this migration deliberately does NOT add is per-row ownership. Venues are
-- shared: the hall an instructor adds is the same hall the next instructor
-- books, and giving the first one edit rights over it would be wrong. The
-- accepted consequence is that any signed-in user can add a venue, i.e. venue
-- spam is possible — the same trust model as "any signed-in user can publish a
-- dance" (docs/decisions/0014). Moderation is a later layer, and there is no
-- update or delete policy here at all, so a bad row can only be removed
-- server-side.

-- ---------------------------------------------------------------------------
-- place_id
-- ---------------------------------------------------------------------------

alter table public.venues add column place_id text;

comment on column public.venues.place_id is
  'Google Places id. Null on the seeded rows, which predate 3.2b; NOT NULL for anything a client inserts, enforced by venues_insert_authenticated. The dedupe key.';

-- Nullable and unique together on purpose. Postgres treats NULLs as distinct in
-- a unique index, so the seeded venues (which have no place_id) coexist happily
-- while every client-supplied place is forced to be unique.
--
-- This index is what makes dedupe correct rather than merely likely: the
-- alternative — SELECT then INSERT from the application — is a race two
-- concurrent instructors adding the same hall would both win, and the table
-- would end up with the duplicate this whole feature exists to prevent.
create unique index venues_place_id_key on public.venues (place_id);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Column-level, following the precedent 0004 set on instructors: the grant is
-- the outer bound and RLS narrows what is left. `id` and `created_at` have
-- defaults and are not a client's to choose; capacity, has_parking,
-- is_accessible and has_ac are curated facts about a hall that this flow never
-- asks for, and 0001 is explicit that null there means "we don't know" rather
-- than "no" — letting a client write them would turn an honest unknown into an
-- unverified claim about wheelchair access.
grant insert (name, address, location, place_id) on public.venues to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- Allows: any signed-in user to add a venue, provided it names a real Google
-- place. Venues are shared infrastructure, not owned, so there is no ownership
-- clause here and deliberately so — see the header.
-- Denies: an anonymous insert (no grant, so it fails at the privilege layer with
-- 42501 before RLS is consulted), and a signed-in insert with no place_id, which
-- is what stops this becoming a free-text venue table.
create policy "venues_insert_authenticated"
  on public.venues for insert
  to authenticated
  with check (place_id is not null);

-- No update or delete policy: a venue is shared, so "who may correct it" is a
-- moderation question nobody has answered yet. Until then, both are refused for
-- every client and stay a service_role operation.

-- ---------------------------------------------------------------------------
-- find_or_create_venue
-- ---------------------------------------------------------------------------

-- One statement pair in one transaction, for the reason docs/decisions/0014
-- records the hard way: application-level check-then-insert is not dedupe, it is
-- a race with good intentions. `on conflict do nothing` makes the insert a no-op
-- when the place is already known, and the select afterwards returns the row
-- either way — so two instructors adding the same hall at the same moment both
-- get the same venue id and the table gains one row.
--
-- SECURITY INVOKER, stated explicitly. It runs as the caller, so the insert is
-- checked by venues_insert_authenticated and by the column grant above; nothing
-- here re-implements either. A DEFINER version would run as the table owner with
-- RLS switched off around it and would hand any caller — including `anon`, if
-- the EXECUTE grant were ever loosened — an unchecked write into a shared table.
--
-- The point is built here rather than accepted from the client as WKT so the
-- SRID cannot be wrong: lat/lng in, geography(Point,4326) out, in one place.
-- Note the argument order — ST_MakePoint takes (x, y) = (longitude, latitude),
-- which is the reverse of how everyone says it out loud, and getting it backwards
-- puts every Israeli venue in Somalia.
create or replace function public.find_or_create_venue(
  p_place_id text,
  p_name text,
  p_address text,
  p_lat double precision,
  p_lng double precision
)
returns table (id uuid, name text, address text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.venues (place_id, name, address, location)
  values (
    p_place_id,
    p_name,
    p_address,
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  )
  on conflict (place_id) do nothing;

  -- Deliberately not `returning` off the insert: on a conflict it returns no
  -- row, and the caller wants the existing venue in exactly that case.
  return query
    select v.id, v.name, v.address
    from public.venues v
    where v.place_id = p_place_id;
end;
$$;

comment on function public.find_or_create_venue(text, text, text, double precision, double precision) is
  'Adds a venue from a Google Place, or returns the existing one with that place_id. One transaction, so concurrent callers converge on a single row rather than racing (docs/decisions/0015). SECURITY INVOKER: the insert is checked by venues_insert_authenticated, not re-implemented here.';

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. Revoking first is what
-- keeps `anon` out of a write entry point entirely — RLS would refuse the insert
-- anyway, but an unauthenticated caller has no business reaching it. service_role
-- is inside PUBLIC and loses it too, deliberately: it bypasses RLS, and a
-- server-side caller holding it would turn an invoker function into an unchecked
-- one.
revoke all on function public.find_or_create_venue(text, text, text, double precision, double precision)
  from public, anon;

grant execute on function public.find_or_create_venue(text, text, text, double precision, double precision)
  to authenticated;
