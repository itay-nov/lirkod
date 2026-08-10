-- 0009 — recurring dances: the schedule columns, the occurrence generator, and
-- the nightly top-up that keeps a horizon of future nights materialised.
--
-- 0001 and 0006 are already applied and are not edited here (AGENTS.md §12/§13);
-- `publish_dance` is re-created below with CREATE OR REPLACE, for one reason
-- stated where it happens.
--
-- This closes both open questions docs/decisions/0002 left behind — how far
-- ahead rows are generated, and who runs the generator — and the recurrence half
-- of AGENTS.md §14. The full reasoning is docs/decisions/0016; this file carries
-- the parts a reader of the SQL needs in front of them.
--
-- Three things are worth knowing before reading any of it:
--
--   1. A night is a ROW, never a rule evaluated at read time (0002). The
--      generator's whole job is to keep those rows ahead of the read horizon.
--   2. The generator NEVER updates and NEVER deletes. Its only write is an
--      INSERT ... ON CONFLICT DO NOTHING. That is how the `overridden_at`
--      invariant is enforced — see the long note above the function.
--   3. Every occurrence's UTC instant is derived by asking the timezone database
--      what Israel's clock read on that specific date. Nothing here adds
--      7 × 24 hours to a timestamptz, which is the version that silently walks
--      an evening an hour sideways twice a year (AGENTS.md §7).

-- ---------------------------------------------------------------------------
-- The recurrence model
--
-- v1 is deliberately not RRULE. It is: weekly or every other week, on the
-- weekday implied by the first night, at a fixed Israel wall-clock time, from a
-- start date, optionally until an end date.
--
-- The schedule is stored as TYPED COLUMNS rather than inside the rule text.
-- docs/decisions/0002 calls `recurrence_rule` "the generator input", and the
-- literal reading of that — a text blob the generator parses — is the one thing
-- this task could not afford: parsing dates and intervals out of a string, in
-- SQL, on the product's most correctness-sensitive surface. A date column
-- compared as a date cannot be misparsed.
--
-- `recurrence_rule` still exists, still holds RRULE text, and is still what a
-- reader (or a future full-RRULE implementation) sees — but it is now a STORED
-- GENERATED column computed from these, so the text and the schedule cannot
-- disagree. Which of the two is authoritative was the only real choice here, and
-- two independent sources of truth was not on the list (the same argument
-- docs/decisions/0003 makes about status vs. override_venue_id).
-- ---------------------------------------------------------------------------

create type public.recurrence_freq as enum ('weekly', 'biweekly');

comment on type public.recurrence_freq is
  'v1 repeat patterns. Deliberately not a general RRULE — see docs/decisions/0016 for what is out of scope and why.';

alter table public.dance_events
  add column recurrence_freq public.recurrence_freq,
  -- The Israel calendar date of the FIRST night of the series. It carries three
  -- things at once and that is why there is no separate weekday column: which
  -- weekday the series falls on, where a biweekly series' phase sits, and the
  -- point before which no night is ever generated.
  add column recurrence_start_date date,
  -- Optional and INCLUSIVE. Null means "until further notice", which is how a
  -- weekly הרקדה actually works.
  add column recurrence_until_date date,
  -- Wall clock in Asia/Jerusalem, NOT an instant. A series does not happen at a
  -- UTC offset, it happens at 20:00; the offset is a property of each individual
  -- night and is resolved per date by the generator.
  add column recurrence_local_start_time time,
  add column recurrence_local_end_time time;

comment on column public.dance_events.recurrence_start_date is
  'Israel calendar date of the series'' first night. Also fixes the weekday and a biweekly series'' phase — every generated night is this date plus a whole number of 7- or 14-day steps.';

comment on column public.dance_events.recurrence_local_start_time is
  'Asia/Jerusalem wall clock, not an instant (AGENTS.md §7). The UTC instant is resolved per night, from the timezone database, so a series keeps its 20:00 across a DST change.';

comment on column public.dance_events.recurrence_local_end_time is
  'Asia/Jerusalem wall clock. At or before the start time means the night ends the following morning — the same reading src/lib/domain/newDance.ts gives a one-off 21:00-00:30 evening.';

alter table public.dance_events
  -- All four required columns, or none of them. A series with a pattern and no
  -- start date, or a start date and no clock, is not a half-specified series —
  -- it is a row the generator would have to guess at, and there is nothing to
  -- guess from.
  add constraint dance_events_recurrence_all_or_nothing check (
    num_nonnulls(
      recurrence_freq,
      recurrence_start_date,
      recurrence_local_start_time,
      recurrence_local_end_time
    ) in (0, 4)
  ),

  -- An end date on a dance that does not recur says nothing, and an end before
  -- the start describes a series with no nights at all. Both are rejected rather
  -- than tolerated-and-ignored: a series that silently generates nothing is a
  -- dance an instructor believes they published (AGENTS.md §10).
  add constraint dance_events_recurrence_until_after_start check (
    recurrence_until_date is null
    or (recurrence_freq is not null and recurrence_until_date >= recurrence_start_date)
  ),

  -- The same twelve-hour ceiling src/lib/domain/newDance.ts applies to a one-off,
  -- restated here because `authenticated` holds a plain UPDATE grant on this
  -- table and can therefore write these columns without going through the RPC.
  -- The wall-clock span, not the elapsed time: an end at or before the start is
  -- read as the next morning, so 21:00-00:30 is 3.5 hours and 20:00-19:00 is 23
  -- and refused.
  add constraint dance_events_recurrence_span_sane check (
    recurrence_freq is null
    or (
      case
        when recurrence_local_end_time > recurrence_local_start_time
          then recurrence_local_end_time - recurrence_local_start_time
        else (recurrence_local_end_time - recurrence_local_start_time) + interval '24 hours'
      end
    ) between interval '1 minute' and interval '12 hours'
  );

-- ---------------------------------------------------------------------------
-- recurrence_rule, re-created as a generated column
--
-- Dropped and re-added rather than left alone. Leaving it writable would mean a
-- row could claim FREQ=WEEKLY;BYDAY=TU while the schedule columns generated
-- Thursdays, and the read path that eventually shows a series' pattern to a
-- dancer would be showing the half nothing acts on.
--
-- It carries the repeat PATTERN only — FREQ, INTERVAL, BYDAY. The series' bounds
-- (DTSTART/UNTIL in RFC 5545 terms) and its clock stay in the typed columns
-- above, because those are what the generator compares and a text UNTIL would
-- have to be parsed back into a date to be used. Stated plainly because it is a
-- narrowing of what the column held before: it is the pattern, not the whole
-- iCalendar description of the series.
--
-- The expression is written inline instead of calling a helper: a generation
-- expression may only use immutable functions, and every piece below (integer
-- date subtraction, modulo, array subscripting, concatenation) is immutable
-- without having to trust a signature. `to_char` is NOT — it is stable, because
-- it reads lc_time — which is the reason no date is formatted into this string.
-- ---------------------------------------------------------------------------

alter table public.dance_events drop column recurrence_rule;

alter table public.dance_events
  add column recurrence_rule text
  generated always as (
    case
      when recurrence_freq is null then null
      else
        'FREQ=WEEKLY'
        || case when recurrence_freq = 'biweekly' then ';INTERVAL=2' else '' end
        || ';BYDAY='
        -- 2024-01-07 is a Sunday, so this is the weekday index 0..6 with no
        -- call to date_part and no dependence on the DateStyle or the locale.
        -- The double modulo keeps it non-negative for a start date before 2024.
        || (array['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'])[
             ((recurrence_start_date - date '2024-01-07') % 7 + 7) % 7 + 1
           ]
    end
  ) stored;

comment on column public.dance_events.recurrence_rule is
  'RRULE text for the repeat pattern (FREQ/INTERVAL/BYDAY), DERIVED from the recurrence_* columns and not writable. Null means the dance does not repeat. The generator reads the typed columns, never this string — it exists so the pattern is legible and cannot drift from what is actually generated (docs/decisions/0002, 0016).';

-- ---------------------------------------------------------------------------
-- event_occurrences.series_date — the generator's idempotency key
--
-- The obvious key is (event_id, starts_at), and it is wrong in exactly the case
-- this table exists to protect. An instructor who moves one night an hour later
-- edits `starts_at` and sets `overridden_at`. The rule's slot for that date is
-- now empty as far as (event_id, starts_at) is concerned, so the next generator
-- pass would helpfully insert the original 20:00 night back — and the dancer
-- sees two nights, one of them the one the instructor thought they had moved.
--
-- So a generated row records the SLOT it came from, and the key is the slot. The
-- occurrence may then be moved, cancelled, or moved again; the slot stays taken.
--
-- Null for a night nobody generated — every row `publish_dance` writes, and any
-- one-off night added by hand. The unique index is partial for that reason: many
-- ungenerated nights per event are fine, one generated night per slot is not.
-- ---------------------------------------------------------------------------

alter table public.event_occurrences add column series_date date;

comment on column public.event_occurrences.series_date is
  'The Asia/Jerusalem calendar date of the recurrence slot this row was generated for; null when the night was not generated from a rule. THE generator''s idempotency key — a slot with a row is a slot the generator leaves alone, whatever was since done to starts_at or status.';

create unique index event_occurrences_series_slot_key
  on public.event_occurrences (event_id, series_date)
  where series_date is not null;

-- ---------------------------------------------------------------------------
-- The generator
--
-- SECURITY INVOKER, and it matters as much as it did in 0006: this runs as the
-- caller, so its INSERT is checked by `event_occurrences_insert_own`
-- (owns_event). An instructor may materialise their own series and nobody
-- else's, and that rule is not re-implemented here — a second copy of an
-- ownership check is a copy that can disagree with the one protecting every
-- other write path. Under pg_cron the caller is the table owner, which is what
-- lets one algorithm serve both.
--
-- THE `overridden_at` INVARIANT (docs/decisions/0002).
--
--   "the generator must never modify or delete a row where overridden_at is not
--   null."
--
-- It is not enforced here by testing `overridden_at is null` before writing.
-- It is enforced by the function containing no UPDATE and no DELETE at all. The
-- single write is an INSERT whose ON CONFLICT action is DO NOTHING, so there is
-- no statement in this function that can change or remove an existing row —
-- overridden or otherwise. A check on `overridden_at` would be a rule someone
-- could later forget in a new branch of the same function; an insert-only
-- function has no such branch to forget it in.
--
-- The reason that is worth this much care: the row it protects is a cancelled
-- night, or one moved to a different hall. Silently regenerating over it puts a
-- dancer in a car to a dark building, which AGENTS.md §10 names as the product's
-- most important failure.
--
-- DST. Each night's instant comes from
--   (slot_date + local_time) AT TIME ZONE 'Asia/Jerusalem'
-- which asks the timezone database what Israel's offset was on THAT date. The
-- tempting alternative — take the first night's timestamptz and add 7 days —
-- adds exactly 168 hours of absolute time and therefore moves a 20:00 dance to
-- 19:00 or 21:00 across a transition. Slot dates are stepped as DATES, where a
-- week is seven calendar days and no offset is involved at all. This is the SQL
-- counterpart of src/lib/domain/jerusalemTime.ts, backed by the same IANA data;
-- tests/db/occurrenceGenerator.test.ts asserts the two agree night by night.
-- ---------------------------------------------------------------------------

create or replace function public.generate_occurrences_for_event(
  p_event_id uuid,
  p_horizon_days integer default 90
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_zone constant text := 'Asia/Jerusalem';
  -- Two years. A horizon is a request from our own code, so an absurd one is a
  -- bug rather than an appetite — and this function is callable by any signed-in
  -- instructor, so an unbounded horizon is also a way to ask Postgres to write a
  -- million rows. Rejected rather than clamped, for the reason migration 0003
  -- gives about a non-positive radius: reinterpreting it would hide the caller's
  -- mistake behind work they never asked for.
  c_max_horizon_days constant integer := 730;
  v_event public.dance_events%rowtype;
  v_today date;
  v_step integer;
  v_last_date date;
  v_first_step integer;
  v_last_step integer;
  v_end_rolls_over integer;
  v_inserted integer;
begin
  if p_horizon_days is null or p_horizon_days < 0 then
    raise exception 'p_horizon_days must be a non-negative number of days, got %', p_horizon_days;
  end if;
  if p_horizon_days > c_max_horizon_days then
    raise exception 'p_horizon_days must be at most %, got %', c_max_horizon_days, p_horizon_days;
  end if;

  select * into v_event from public.dance_events e where e.id = p_event_id;
  if not found then
    raise exception 'no dance_events row with id %', p_event_id;
  end if;

  -- Not an error. "Top up this dance" for a one-off dance is a no-op, and the
  -- system pass below would otherwise have to know the difference.
  if v_event.recurrence_freq is null then
    return 0;
  end if;

  v_step := case when v_event.recurrence_freq = 'biweekly' then 14 else 7 end;

  -- Today in Israel, not today in UTC: at 01:00 Jerusalem those are different
  -- dates, and the one that decides whether tonight's dance still needs a row is
  -- the local one.
  v_today := (now() at time zone c_zone)::date;

  v_last_date := least(
    v_today + p_horizon_days,
    coalesce(v_event.recurrence_until_date, v_today + p_horizon_days)
  );

  -- Slots are counted in whole steps from the start date, so a biweekly series
  -- keeps its phase no matter when the generator happens to run.
  --
  -- Both divisions have a non-negative numerator by construction, so integer
  -- division truncating toward zero is floor division here. The two CASE arms
  -- are what keeps that true: without them a series starting after today, or
  -- ending before it, would divide a negative number and land on step 0.
  v_first_step := case
    when v_today <= v_event.recurrence_start_date then 0
    else ((v_today - v_event.recurrence_start_date) + v_step - 1) / v_step
  end;
  v_last_step := case
    when v_last_date < v_event.recurrence_start_date then -1
    else (v_last_date - v_event.recurrence_start_date) / v_step
  end;

  -- An end time at or before the start time belongs to the next morning — the
  -- same reading `resolveEnd` gives in src/lib/domain/newDance.ts, so a
  -- recurring 21:00-00:30 evening is stored exactly like a one-off one.
  v_end_rolls_over := case
    when v_event.recurrence_local_end_time > v_event.recurrence_local_start_time then 0
    else 1
  end;

  insert into public.event_occurrences (event_id, series_date, starts_at, ends_at, status)
  select
    v_event.id,
    slot.slot_date,
    (slot.slot_date + v_event.recurrence_local_start_time) at time zone c_zone,
    (slot.slot_date + v_end_rolls_over + v_event.recurrence_local_end_time) at time zone c_zone,
    -- Every generated night arrives 'scheduled' with no override. A night that
    -- is anything else got that way from a human, and this function is not
    -- allowed to be that human — which the ON CONFLICT below is what enforces.
    'scheduled'::public.occurrence_status
  from generate_series(v_first_step, v_last_step) as step(n)
  cross join lateral (
    select v_event.recurrence_start_date + (step.n * v_step) as slot_date
  ) slot
  -- The whole invariant, in one clause. The row that is already there wins,
  -- always, and this statement has no way to express anything else.
  on conflict (event_id, series_date) where series_date is not null
  do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.generate_occurrences_for_event(uuid, integer) is
  'Materialises one recurring dance''s nights up to the horizon, in Asia/Jerusalem wall-clock time. Insert-only and idempotent on (event_id, series_date): a slot that already has a row is never touched, which is how the overridden_at invariant of docs/decisions/0002 is enforced. SECURITY INVOKER — ownership is event_occurrences_insert_own''s job, not this function''s.';

revoke all on function public.generate_occurrences_for_event(uuid, integer) from public, anon;

-- Granted to `authenticated` so publish_recurring_dance can materialise a brand
-- new series inside the publishing transaction, instead of leaving the
-- instructor with a dance that has no nights until the cron job next runs.
-- Reaching somebody else's series through it fails on
-- event_occurrences_insert_own, which is asserted in tests/rls.
grant execute on function public.generate_occurrences_for_event(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- The system top-up — what pg_cron runs
--
-- SECURITY DEFINER, which everywhere else in this schema would be a mistake
-- (see the note in 0006 about what a definer publish_dance would open up). Here
-- it is the correct answer and the reasons are specific: this is a system job,
-- not a user action; it writes across every instructor's events, so there is no
-- "caller" whose RLS should apply; and the row-level policies it would otherwise
-- be subject to are written for a client with a session, which a cron worker
-- does not have.
--
-- So it is locked instead. EXECUTE is revoked from PUBLIC — which is where
-- CREATE FUNCTION puts it by default, and which includes service_role — and
-- granted only to `postgres`, the role pg_cron runs the job as. No API role can
-- reach it: `anon` and `authenticated` get 42501 from Postgres itself, and
-- PostgREST does not expose a function the authenticator cannot execute.
--
-- No horizon parameter, deliberately. The horizon is a product decision
-- (docs/decisions/0016), not a knob for whoever schedules the job, and one
-- default in one place is one thing that can be wrong.
-- ---------------------------------------------------------------------------

create or replace function public.generate_occurrences()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_total integer := 0;
begin
  for v_event_id in
    select e.id
    from public.dance_events e
    where e.recurrence_freq is not null
    order by e.id
  loop
    v_total := v_total + public.generate_occurrences_for_event(v_event_id);
  end loop;

  return v_total;
end;
$$;

comment on function public.generate_occurrences() is
  'The nightly top-up pg_cron runs: rolls every recurring dance''s horizon forward. SECURITY DEFINER because it is a system job writing across all instructors, and locked to the postgres role for exactly that reason — no client, signed in or not, can call it.';

revoke all on function public.generate_occurrences() from public, anon, authenticated, service_role;
grant execute on function public.generate_occurrences() to postgres;

-- ---------------------------------------------------------------------------
-- publish_dance, re-created
--
-- Untouched except for one line: `recurrence_rule` is gone from the INSERT
-- column list, because a generated column cannot be written to and naming it —
-- even as NULL, which is what 0006 did — now fails with 428C9. The behaviour is
-- identical; a one-off dance still has no recurrence, it now says so by leaving
-- every recurrence column unset.
--
-- Everything 0006 says about this function still applies and is not repeated:
-- SECURITY INVOKER on purpose, ownership enforced by the policies rather than
-- re-implemented, EXECUTE withheld from anon and service_role.
-- ---------------------------------------------------------------------------

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
  -- that the dance is free (see 0006).
  insert into public.dance_events (instructor_id, venue_id, price_agorot)
  values (p_instructor_id, p_venue_id, 0)
  returning id into v_event_id;

  -- series_date stays null: this night came from a person, not from a rule, so
  -- it occupies no slot and the generator has no opinion about it.
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

revoke all on function public.publish_dance(uuid, uuid, timestamptz, timestamptz)
  from public, anon;

grant execute on function public.publish_dance(uuid, uuid, timestamptz, timestamptz)
  to authenticated;

-- ---------------------------------------------------------------------------
-- publish_recurring_dance — the write path
--
-- A sibling of publish_dance rather than a fifth and sixth parameter on it. The
-- two take genuinely different inputs: a one-off night is two INSTANTS, already
-- converted from Israel wall clock by src/lib/domain/jerusalemTime.ts, while a
-- series is a WALL CLOCK and a pattern, because its instants do not exist yet
-- and cannot be computed once for all of them. Folding both into one function
-- would mean four parameters that are only sometimes meaningful.
--
-- Same transaction shape and same reasoning as 0006: PostgREST wraps one RPC in
-- one transaction, so a series whose nights cannot be written takes its
-- dance_events row down with it. A recurring dance with no nights is the same
-- publicly readable orphan 0006 exists to prevent — `anon` holds SELECT on
-- dance_events with `using (true)` — which is why zero materialised nights is an
-- error here rather than an empty success.
--
-- SECURITY INVOKER, so both writes are checked by dance_events_insert_own and
-- (through the generator) event_occurrences_insert_own.
-- ---------------------------------------------------------------------------

create or replace function public.publish_recurring_dance(
  p_instructor_id uuid,
  p_venue_id uuid,
  p_freq public.recurrence_freq,
  p_start_date date,
  p_local_start_time time,
  p_local_end_time time,
  p_until_date date default null
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
    recurrence_local_end_time
  )
  values (
    p_instructor_id,
    p_venue_id,
    0,
    p_freq,
    p_start_date,
    p_until_date,
    p_local_start_time,
    p_local_end_time
  )
  returning id into v_event_id;

  v_count := public.generate_occurrences_for_event(v_event_id);

  -- A series entirely in the past, or one whose only nights sit beyond the
  -- horizon, produces nothing. Both are an instructor believing they published
  -- something that a dancer will never see, so the transaction is refused and
  -- the form gets to say so.
  if v_count = 0 then
    raise exception
      'this series materialises no nights between today and the horizon'
      using errcode = 'P0001';
  end if;

  return query select v_event_id, v_count;
end;
$$;

comment on function public.publish_recurring_dance(uuid, uuid, public.recurrence_freq, date, time, time, date) is
  'Publishes a recurring dance and its first horizon of nights in one transaction. Takes Israel WALL CLOCK, not instants — a series'' UTC offsets differ night to night and are resolved per date by the generator. SECURITY INVOKER: ownership is dance_events_insert_own and event_occurrences_insert_own.';

revoke all on function public.publish_recurring_dance(uuid, uuid, public.recurrence_freq, date, time, time, date)
  from public, anon;

grant execute on function public.publish_recurring_dance(uuid, uuid, public.recurrence_freq, date, time, time, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- pg_cron
--
-- The daily top-up. 00:00 UTC is 03:00 in Israel in summer and 02:00 in winter,
-- and pg_cron reads its schedules in GMT (`cron.timezone`, a server-wide GUC we
-- are not going to change from a migration). The drift is deliberate and
-- harmless: with a 90-day horizon, a pass is roughly 89 days early, so the hour
-- it runs at is not load-bearing — only that it runs.
--
-- Scheduling by name is an upsert in pg_cron, so re-running this migration
-- against a project that already has the job replaces it instead of creating a
-- second one.
--
-- HOSTED: if `create extension pg_cron` is refused on the hosted project, the
-- extension has to be enabled once from the dashboard (Database → Extensions)
-- and this migration re-run. Nothing else here depends on cron — the functions
-- above stand on their own, and every test invokes them directly rather than
-- waiting for a job to fire.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

select cron.schedule(
  'lirkod-top-up-occurrences',
  '0 0 * * *',
  $cron$select public.generate_occurrences();$cron$
);
