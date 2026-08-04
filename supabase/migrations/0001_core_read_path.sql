-- 0001 — core read path: profiles, instructors, venues, dance_events, event_occurrences.
--
-- Scope is reading a dance off the map. No payments, attendance, or loyalty tables —
-- those get their own migrations.
--
-- Conventions this migration follows (AGENTS.md §7, §8):
--   * money is integer agorot, never a float
--   * every timestamp is timestamptz, stored UTC, displayed in Asia/Jerusalem
--   * RLS is enabled on every table and its policies live in this same file
--
-- The occurrence model (materialized rows, not RRULE expansion at query time) is
-- docs/decisions/0002. The status/override_venue_id split is docs/decisions/0003.

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- PostGIS lives outside public so it does not collide with application objects, which
-- means the gist operator classes for geography are not on the default search_path.
-- Without this, `using gist (location)` below fails to find an operator class.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  -- E.164 (AGENTS.md §7). Israeli input formats are normalised before they reach here.
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{1,14}$'),
  home_location extensions.geography(point, 4326),
  created_at timestamptz not null default now()
);

comment on column public.profiles.home_location is
  'Optional. Used to centre the map before a geolocation prompt (AGENTS.md §9) — never required to browse.';

-- ---------------------------------------------------------------------------
-- instructors (מרקידים)
-- ---------------------------------------------------------------------------

-- Identity is deliberately split across two tables:
--
--   public.instructors  — the PUBLIC identity. Anonymous-readable. display_name, bio
--                         and verified are what a dancer sees next to a dance on the
--                         map, with no account (AGENTS.md §2.1, §2.2).
--   public.profiles     — the PRIVATE identity. Owner-only, never public. Holds the
--                         phone number and home location.
--
-- The two display_name columns are not a duplication bug. They answer different
-- questions: the public one is the name the community knows a מרקיד by, the private
-- one is the account holder's own name, and an instructor may well want them to
-- differ. Nothing joins profiles into a public read path — that is the point.
create table public.instructors (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles (id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  bio text,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

comment on column public.instructors.display_name is
  'The instructor''s PUBLIC identity — anonymous-readable, shown next to a dance so the map can say who runs it. The private counterpart is public.profiles.display_name, which is owner-only and must not be exposed.';

comment on column public.instructors.verified is
  'Trust flag set by us, never self-served. Enforced by a column-level privilege below, not by RLS.';

-- ---------------------------------------------------------------------------
-- venues
-- ---------------------------------------------------------------------------

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  address text not null check (length(btrim(address)) > 0),
  location extensions.geography(point, 4326) not null,
  capacity integer check (capacity > 0),
  has_parking boolean,
  is_accessible boolean,
  has_ac boolean,
  created_at timestamptz not null default now()
);

-- Nullable on purpose: null means "we don't know", which is not the same as "no".
-- Telling a dancer with limited mobility that a hall is not accessible when nobody has
-- checked is worse than saying nothing.
comment on column public.venues.has_parking is 'null = unknown, not false.';
comment on column public.venues.is_accessible is 'null = unknown, not false.';
comment on column public.venues.has_ac is 'null = unknown, not false.';

-- ---------------------------------------------------------------------------
-- dance_events — the recurring series
-- ---------------------------------------------------------------------------

create table public.dance_events (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  dance_types text[] not null default '{}'
    check (array_position(dance_types, null) is null),
  recurrence_rule text,
  price_agorot integer not null check (price_agorot >= 0),
  created_at timestamptz not null default now()
);

comment on column public.dance_events.recurrence_rule is
  'RRULE text. Generator input only — the pattern. An event_occurrences row outranks it for a given night (docs/decisions/0002).';

comment on column public.dance_events.price_agorot is
  'Agorot, never shekels and never a float (AGENTS.md §7). Formatted for display at the edge only.';

comment on column public.dance_events.venue_id is
  'The series'' usual venue. A single night can override it via event_occurrences.override_venue_id.';

-- ---------------------------------------------------------------------------
-- event_occurrences — one row per actual night
-- ---------------------------------------------------------------------------

create type public.occurrence_status as enum ('scheduled', 'cancelled', 'moved');

create table public.event_occurrences (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.dance_events (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.occurrence_status not null default 'scheduled',
  override_venue_id uuid references public.venues (id) on delete restrict,
  cancellation_reason text,
  overridden_at timestamptz,
  created_at timestamptz not null default now(),

  constraint event_occurrences_ends_after_starts check (ends_at > starts_at),

  -- docs/decisions/0003. The combination this exists to forbid is
  -- (scheduled, override_venue_id not null): the venue changed but the dancer is
  -- shown no "הועבר" label and no alert fires, so they drive to the old hall.
  -- AGENTS.md §10 makes that the most important failure to prevent, so it is made
  -- unrepresentable rather than left to every future writer to remember.
  -- 'moved' with no new venue is also rejected — there is no time-override column,
  -- so it would carry no information. 'cancelled' is left free: a night can be moved
  -- on Monday and cancelled on Tuesday, and nulling the override would erase that.
  constraint event_occurrences_status_matches_override check (
       (status = 'scheduled' and override_venue_id is null)
    or (status = 'moved' and override_venue_id is not null)
    or (status = 'cancelled')
  )
);

comment on column public.event_occurrences.overridden_at is
  'Non-null means a human edited this specific night. INVARIANT: the occurrence generator must never modify or delete a row where overridden_at is not null. Not enforceable as a constraint — it constrains the writer, not the row — so it lives here and in docs/decisions/0002.';

comment on column public.event_occurrences.override_venue_id is
  'Authoritative for WHERE. Resolve a night''s venue as coalesce(override_venue_id, dance_events.venue_id); never infer a location from status.';

comment on column public.event_occurrences.status is
  'Authoritative for WHAT THE DANCER IS TOLD — drives the visible "בוטל"/"הועבר" label (AGENTS.md §2.6 forbids colour-only state). Never derive an address from it.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- GIST on every geography column (AGENTS.md §9 — proximity runs in Postgres).
create index profiles_home_location_gix on public.profiles using gist (home_location);
create index venues_location_gix on public.venues using gist (location);

create index dance_events_instructor_id_idx on public.dance_events (instructor_id);
create index dance_events_venue_id_idx on public.dance_events (venue_id);

create index event_occurrences_event_id_idx on public.event_occurrences (event_id);
create index event_occurrences_starts_at_idx on public.event_occurrences (starts_at);
create index event_occurrences_status_idx on public.event_occurrences (status);
create index event_occurrences_override_venue_id_idx on public.event_occurrences (override_venue_id);

-- ---------------------------------------------------------------------------
-- Ownership helpers
--
-- security definer so a policy does not depend on the caller being able to read
-- public.instructors under RLS. search_path is pinned to '' so every reference has to
-- be schema-qualified and the function cannot be captured by a caller's search_path.
-- ---------------------------------------------------------------------------

create or replace function public.owns_instructor(p_instructor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.instructors i
    where i.id = p_instructor_id
      and i.profile_id = (select auth.uid())
  );
$$;

create or replace function public.owns_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.dance_events e
    join public.instructors i on i.id = e.instructor_id
    where e.id = p_event_id
      and i.profile_id = (select auth.uid())
  );
$$;

revoke all on function public.owns_instructor(uuid) from public, anon;
revoke all on function public.owns_event(uuid) from public, anon;
grant execute on function public.owns_instructor(uuid) to authenticated;
grant execute on function public.owns_event(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges
--
-- Postgres checks GRANTs first and RLS second — a policy can only narrow what a grant
-- already allows, never widen it. These are written out per table rather than left to
-- the project's default privileges, so that what each role can reach is reviewable in
-- one place instead of inherited from environment setup.
--
-- Each table starts with a REVOKE so the grants below are authoritative even where
-- default privileges have already handed `anon`/`authenticated` blanket access.
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon, authenticated;
revoke all on public.instructors from anon, authenticated;
revoke all on public.venues from anon, authenticated;
revoke all on public.dance_events from anon, authenticated;
revoke all on public.event_occurrences from anon, authenticated;

-- service_role bypasses RLS, but privileges are checked before RLS, so it still needs
-- these. Server-only (AGENTS.md §8).
grant all on public.profiles to service_role;
grant all on public.instructors to service_role;
grant all on public.venues to service_role;
grant all on public.dance_events to service_role;
grant all on public.event_occurrences to service_role;

-- anon reads the map and nothing else. No write privilege on any table, so an
-- anonymous write is refused at the privilege layer before RLS is even consulted.
grant select on public.instructors to anon;
grant select on public.venues to anon;
grant select on public.dance_events to anon;
grant select on public.event_occurrences to anon;

grant select, insert, update on public.profiles to authenticated;

grant select, insert on public.instructors to authenticated;
-- Only these two columns, never `verified`. RLS is row-level and cannot say "every
-- column except this one", so withholding table-wide UPDATE is what stops an
-- instructor from setting their own verified = true; the ownership policy below would
-- otherwise happily allow it.
grant update (display_name, bio) on public.instructors to authenticated;

grant select, insert, update, delete on public.dance_events to authenticated;
grant select, insert, update, delete on public.event_occurrences to authenticated;

-- venues: authenticated deliberately gets read only. Venues are curated server-side.
grant select on public.venues to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
--
-- Read access is the product (AGENTS.md §2.1, §2.2): a dancer taps a WhatsApp link and
-- sees the map, with no account. So venues, dance_events and event_occurrences are
-- readable by `anon`. profiles are not — they are personal data.
--
-- Note on writes: a table with RLS enabled and no policy for a command denies that
-- command to anon and authenticated. Where a write policy is absent below, that is the
-- intent, and it is stated. service_role bypasses RLS entirely and is server-only.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.instructors enable row level security;
alter table public.venues enable row level security;
alter table public.dance_events enable row level security;
alter table public.event_occurrences enable row level security;

-- profiles ------------------------------------------------------------------

-- Allows: a signed-in user to read their own profile row, and only that row.
-- Denies: all anonymous reads, and any read of another user's row. phone,
-- home_location and this display_name are personal data (AGENTS.md §8), so there is
-- deliberately no public-read policy here. An instructor's publicly visible name is a
-- separate column on public.instructors — do not relax this policy to expose a name.
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

-- Allows: a signed-in user to create the one profile row whose id is their own
-- auth.users id, immediately after phone-OTP sign-up.
-- Denies: creating a profile on behalf of any other user id.
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- Allows: a signed-in user to edit their own profile.
-- Denies: editing anyone else's profile, and — via the with check half — re-assigning
-- their row to a different id on the way out.
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No delete policy: account deletion cascades from auth.users and is a server-side
-- concern, so nobody deletes a profile row directly through the API.

-- instructors ---------------------------------------------------------------

-- Allows: anyone, signed in or not, to read every instructor row. display_name, bio and
-- verified are the instructor's public identity — a dancer opening the map from a
-- WhatsApp link has to be able to see who runs a dance, and §2.2 forbids gating reads.
-- Denies: nothing on read — which is exactly why this table holds only what is meant to
-- be public. The instructor's phone and home location stay on public.profiles, which is
-- owner-only and is never joined into a public read path.
create policy "instructors_select_public"
  on public.instructors for select
  to anon, authenticated
  using (true);

-- Allows: a signed-in user to claim one instructor row for their own profile.
-- Denies: creating an instructor row that points at somebody else's profile.
create policy "instructors_insert_own"
  on public.instructors for insert
  to authenticated
  with check ((select auth.uid()) = profile_id);

-- Allows: an instructor to edit their own row — in practice display_name and bio only,
-- see the column grant below.
-- Denies: editing another instructor's row, and re-pointing their row at another profile.
create policy "instructors_update_own"
  on public.instructors for update
  to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- `verified` is held down by the column-level grant in the privileges section above,
-- not by this policy.

-- No delete policy: removing an instructor would orphan their dances, which is a
-- server-side decision, not a client one.

-- venues --------------------------------------------------------------------

-- Allows: anyone, signed in or not, to read every venue. The map is the entry point
-- and has to work from a WhatsApp link with no account (AGENTS.md §2.1).
-- Denies: nothing on read. A venue holds no personal data.
create policy "venues_select_public"
  on public.venues for select
  to anon, authenticated
  using (true);

-- No insert/update/delete policies: venues are curated server-side via service_role
-- until a task defines who may create one. Every client write is denied.

-- dance_events --------------------------------------------------------------

-- Allows: anyone, signed in or not, to read every dance. This is the product premise
-- (AGENTS.md §2.2) — seeing what is on tonight must not require an account.
-- Denies: nothing on read. price_agorot is public by design; it is what the door
-- would charge anyway.
create policy "dance_events_select_public"
  on public.dance_events for select
  to anon, authenticated
  using (true);

-- Allows: an instructor to create a dance owned by their own instructor row.
-- Denies: anonymous creation, and creating a dance attributed to another instructor.
create policy "dance_events_insert_own"
  on public.dance_events for insert
  to authenticated
  with check (public.owns_instructor(instructor_id));

-- Allows: an instructor to edit their own dance.
-- Denies: editing another instructor's dance (using), and handing their own dance to
-- another instructor by rewriting instructor_id (with check).
create policy "dance_events_update_own"
  on public.dance_events for update
  to authenticated
  using (public.owns_instructor(instructor_id))
  with check (public.owns_instructor(instructor_id));

-- Allows: an instructor to delete their own dance.
-- Denies: deleting a dance belonging to anyone else.
create policy "dance_events_delete_own"
  on public.dance_events for delete
  to authenticated
  using (public.owns_instructor(instructor_id));

-- event_occurrences ---------------------------------------------------------

-- Allows: anyone, signed in or not, to read every occurrence — including cancelled and
-- moved ones. A dancer must be able to see "בוטל" without logging in; hiding a
-- cancelled row would send them out to a hall that is dark (AGENTS.md §10).
-- Denies: nothing on read.
create policy "event_occurrences_select_public"
  on public.event_occurrences for select
  to anon, authenticated
  using (true);

-- Allows: an instructor to add a night to a dance they own.
-- Denies: anonymous creation, and adding a night to another instructor's dance.
create policy "event_occurrences_insert_own"
  on public.event_occurrences for insert
  to authenticated
  with check (public.owns_event(event_id));

-- Allows: an instructor to cancel, move, or re-time a night of their own dance. This
-- is the write behind the product's most important moment (AGENTS.md §10).
-- Denies: touching another instructor's night (using), and moving one of their own
-- nights onto someone else's dance by rewriting event_id (with check).
create policy "event_occurrences_update_own"
  on public.event_occurrences for update
  to authenticated
  using (public.owns_event(event_id))
  with check (public.owns_event(event_id));

-- Allows: an instructor to delete a night of their own dance.
-- Denies: deleting a night of anyone else's dance.
create policy "event_occurrences_delete_own"
  on public.event_occurrences for delete
  to authenticated
  using (public.owns_event(event_id));
