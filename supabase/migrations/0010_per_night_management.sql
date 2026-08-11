-- 0010 — per-night management: an instructor cancels or re-times ONE night.
--
-- 0001 and 0009 are already applied and are not edited here (AGENTS.md §12/§13).
-- `find_dances_near` is dropped and recreated below, for one stated reason.
--
-- This is the write path 0002 predicted and 0009's generator was built to
-- survive: a human changing a single materialised night, without the nightly
-- top-up ever undoing it. The whole of this migration is about making that safe
-- at the DATABASE, because the Server Action is not the only caller — anyone
-- holding a session can reach these rows through PostgREST directly.
--
-- Four rules, and each one is a different mechanism because each one fails
-- differently:
--
--   1. A night is never deleted by a client.        -> policy dropped + REVOKE
--   2. `series_date` is never written by a client.  -> column-scoped GRANT
--   3. A changed night always carries a marker.     -> BEFORE UPDATE trigger
--   4. A marked night is never silently normal.     -> CHECK constraint
--
-- Rules 1 and 2 are the ones that protect the generator. Rules 3 and 4 are what
-- make "this night was touched by a person" a fact of the row rather than a
-- convention the next writer has to remember.

-- ---------------------------------------------------------------------------
-- 1. A client may not DELETE a night. Cancelling is the product's answer.
--
-- This is the sharpest edge in the whole feature and it is worth being explicit
-- about why deleting looks right and is not.
--
-- The generator (0009) is insert-only and keyed on (event_id, series_date). A
-- night it has already produced is skipped because the SLOT IS OCCUPIED — not
-- because of anything about the row's contents. Delete that row and the slot is
-- free again, so the next nightly pass re-creates the night, at its original
-- time, with status 'scheduled'. A dancer is then told a cancelled dance is on.
-- That is AGENTS.md §10's worst case arriving up to 24 hours after an instructor
-- believed they had dealt with it, which is worse than it never having worked.
--
-- A soft cancel keeps the row, keeps the slot taken, and keeps the "בוטל" the
-- dancer has to see (§2.6). So DELETE is removed rather than discouraged.
--
-- Deleting the whole dance is untouched: `dance_events_delete_own` still exists
-- and cascades. That is a different action — the series stops existing, so there
-- is no rule left to regenerate from — and it is the honest way to unpublish.
-- ---------------------------------------------------------------------------

drop policy "event_occurrences_delete_own" on public.event_occurrences;

-- The policy alone would be enough today, but a policy is a row filter and this
-- is a statement-level prohibition. Withholding the privilege means a DELETE is
-- refused with 42501 before RLS is consulted, and it cannot be re-enabled by
-- someone adding a permissive policy later without also noticing this line.
revoke delete on public.event_occurrences from authenticated;

-- ---------------------------------------------------------------------------
-- `original_starts_at` — what makes a re-timed night visible
--
-- Added before the grants below, which name it.
--
-- Moving one night to a different hour is new in this phase, and without this
-- column it would be the one change a dancer is never told about. The status
-- enum has no value for it: docs/decisions/0003 gives `moved` to a venue change
-- and forbids `moved` with no new venue, and says in as many words that a
-- time-only move "needs its own column and a new migration". This is that
-- column.
--
-- Deliberately the ORIGINAL time rather than a boolean. "הועבר מ-20:00" is what
-- a dancer who already made a plan actually needs; a bare "changed" badge makes
-- them work out what changed. It also costs nothing extra to store.
--
-- Null means the night is at the time its series (or its publisher) said. The
-- CHECK forbids it equalling `starts_at`, so a night moved back to where it
-- started cannot keep claiming it was moved.
-- ---------------------------------------------------------------------------

alter table public.event_occurrences
  add column original_starts_at timestamptz,
  add constraint event_occurrences_original_differs
    check (original_starts_at is null or original_starts_at <> starts_at);

comment on column public.event_occurrences.original_starts_at is
  'The time this night was at before a human moved it, or null if it was never moved. Drives the "הועבר מ-HH:MM" label — status stays ''scheduled'' for a time-only move, because docs/decisions/0003 reserves ''moved'' for a venue change.';

-- ---------------------------------------------------------------------------
-- 2. `series_date` is the generator's idempotency key, so no client writes it.
--
-- 0001 granted table-wide UPDATE to `authenticated`, which was right when every
-- column on this table was the instructor's to set. 0009 added a column that is
-- not: `series_date` says which slot of the recurrence a row occupies, and
-- rewriting it either frees a slot (the night comes back, as above) or steals
-- another one.
--
-- RLS cannot express this — a policy is row-level and cannot say "every column
-- except that one" — so it is a column-level GRANT, the same instrument
-- migration 0001 uses to keep `instructors.verified` out of reach.
--
-- `id`, `event_id` and `created_at` fall outside the list too. `event_id` was
-- already covered by `event_occurrences_update_own`'s WITH CHECK; it is now
-- refused one layer earlier, at the privilege check, and the policy stays as
-- defence in depth.
-- ---------------------------------------------------------------------------

revoke update on public.event_occurrences from authenticated;

grant update (
  starts_at,
  ends_at,
  status,
  override_venue_id,
  cancellation_reason,
  overridden_at,
  original_starts_at
) on public.event_occurrences to authenticated;

-- ---------------------------------------------------------------------------
-- 4. A night that deviates from its rule always says so.
--
-- The three ways a night can deviate are: it is not 'scheduled', its venue was
-- overridden (which 0001's constraint already ties to status 'moved'), or its
-- time was moved. Every one of them is a human's doing, and `overridden_at` is
-- how the row records that.
--
-- Stated as a constraint rather than trusted to the writer because the writer is
-- whoever holds a session, not only this application. The trigger below is what
-- makes satisfying it automatic; this is what makes violating it impossible.
-- ---------------------------------------------------------------------------

alter table public.event_occurrences
  add constraint event_occurrences_change_is_marked check (
    overridden_at is not null
    or (status = 'scheduled' and original_starts_at is null)
  );

-- ---------------------------------------------------------------------------
-- 3. The marker is stamped by the database, not by the caller.
--
-- `overridden_at` is documentation — of the four rules here it is the only one
-- the generator does not read, because 0009's safety rests on the slot being
-- occupied rather than on anything in the row. That is precisely why it is worth
-- automating: a marker nothing enforces is a marker that is right until the
-- first caller forgets it, and by then the audit trail it existed for is gone.
--
-- Two behaviours, both deliberate:
--
--   * Any change to a night's own fields stamps `now()`. A caller cannot edit a
--     night and leave it looking untouched, whether they came through /profile
--     or straight through PostgREST with their own token.
--   * An existing stamp is never cleared. Once a person has touched a night,
--     that stays true even if they put every field back — the row really was
--     edited, and "restore it and nobody will know" is not a capability worth
--     having on the table AGENTS.md §10 is about.
--
-- BEFORE UPDATE, so it rewrites the row on its way in rather than issuing a
-- second write. SECURITY INVOKER (the default, stated): it touches no table and
-- needs no privileges the caller lacks.
-- ---------------------------------------------------------------------------

create or replace function public.stamp_occurrence_override()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    new.starts_at, new.ends_at, new.status,
    new.override_venue_id, new.cancellation_reason, new.original_starts_at
  ) is distinct from (
    old.starts_at, old.ends_at, old.status,
    old.override_venue_id, old.cancellation_reason, old.original_starts_at
  ) then
    new.overridden_at := now();
  else
    -- Nothing about the night changed, so this is either a no-op write or an
    -- attempt to clear the marker on its own. The old value wins if there is one.
    new.overridden_at := coalesce(old.overridden_at, new.overridden_at);
  end if;

  return new;
end;
$$;

comment on function public.stamp_occurrence_override() is
  'BEFORE UPDATE on event_occurrences: stamps overridden_at whenever a night''s own fields change, and never lets an existing stamp be cleared. Makes the soft-cancel contract of docs/decisions/0017 a property of the table rather than of its callers.';

create trigger event_occurrences_stamp_override
  before update on public.event_occurrences
  for each row
  execute function public.stamp_occurrence_override();

-- ---------------------------------------------------------------------------
-- find_dances_near, recreated to carry the re-timed flag
--
-- DROP and CREATE rather than CREATE OR REPLACE: the function gains an OUT
-- column, and Postgres refuses to replace a set-returning function whose result
-- columns changed. Everything else about it — the 50km clamp, the 60-day
-- horizon, the 200-row limit, the lat/lng validation, the SECURITY INVOKER
-- stance — is migration 0003's and is carried across unchanged, including its
-- comments' reasoning. The grants are restated because DROP takes the ACL with
-- it.
--
-- It still does not filter by status. A cancelled night must keep reaching an
-- anonymous visitor so the UI can draw "בוטל" (AGENTS.md §2.6, §10); hiding it
-- is how a dancer ends up outside a dark hall, which is the whole reason this
-- product treats cancellations as the critical path.
-- ---------------------------------------------------------------------------

drop function public.find_dances_near(double precision, double precision, double precision);

create function public.find_dances_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters double precision
)
returns table (
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
  'The public map''s proximity query (AGENTS.md §9). Does not filter by status — a cancelled, moved or re-timed night must still reach an anonymous visitor, with whatever it needs to render the required label (AGENTS.md §2.6, §10). Radius is clamped to 50km, results are capped at 200 rows within a 60-day horizon, and invalid lat/lng/radius are rejected — see migration 0003''s header for why each choice is a clamp vs. a rejection.';

revoke all on function public.find_dances_near(double precision, double precision, double precision) from public;
grant execute on function public.find_dances_near(double precision, double precision, double precision) to anon, authenticated;
