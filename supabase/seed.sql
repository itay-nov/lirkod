-- Local dev seed data. Loaded automatically by `supabase db reset`.
--
-- One instructor, three venues at deliberate distances from Holon, one dance per
-- venue, one scheduled occurrence each a few days out. The distances are what
-- tests/db/proximity.test.ts asserts against:
--   (a) Holon      — the query origin
--   (b) Tel Aviv   — ~8.5km from (a): inside a 50km radius, outside a 5km one
--   (c) Eilat      — ~270km from (a): outside both
--
-- IDs are fixed (not gen_random_uuid()) so the test can reference specific rows
-- without re-deriving them.

-- auth.users is inserted directly, not through the Auth admin API, because this file
-- runs as plain SQL during `db reset`. instance_id is the all-zero UUID GoTrue uses
-- for a local/single-tenant stack. This user is never signed in through OTP here — it
-- only needs to exist to satisfy profiles.id's foreign key.
--
-- The four empty-string token columns are not padding. They have no column default,
-- and GoTrue scans them into non-nullable Go strings — one NULL row makes
-- `GET /admin/users` fail for the WHOLE table with "converting NULL to string is
-- unsupported". That breaks tests/rls/fixtures.ts's teardown, which finds its test
-- users through listUsers: teardown silently deleted nothing, and the next
-- `npm run test:rls` died on "Phone number already registered by another user".
-- The remaining token columns already default to ''.
insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  '+972500000100',
  now(),
  '', '', '', '',
  '{"provider":"phone","providers":["phone"]}',
  '{}',
  now(),
  now()
);

insert into public.profiles (id, display_name, phone) values (
  'a0000000-0000-0000-0000-000000000001',
  'רונית לוי',
  '+972500000100'
);

insert into public.instructors (id, profile_id, display_name, bio, verified) values (
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'רונית מרקידה',
  'מרקידה ותיקה, מלמדת ריקודי עם כבר 20 שנה.',
  true
);

-- Venues ----------------------------------------------------------------------

insert into public.venues (id, name, address, location, capacity, has_parking, is_accessible, has_ac) values
  (
    'b0000000-0000-0000-0000-000000000001',
    'היכל התרבות חולון',
    'ויצמן 24, חולון',
    extensions.st_setsrid(extensions.st_makepoint(34.7736, 32.0114), 4326)::extensions.geography,
    300,
    true,
    true,
    true
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    'בית ציוני אמריקה',
    'שדרות שאול המלך 26, תל אביב',
    extensions.st_setsrid(extensions.st_makepoint(34.7818, 32.0853), 4326)::extensions.geography,
    250,
    false,
    true,
    true
  ),
  (
    'b0000000-0000-0000-0000-000000000003',
    'מועדון הפיס אילת',
    'התמרים 1, אילת',
    extensions.st_setsrid(extensions.st_makepoint(34.9482, 29.5581), 4326)::extensions.geography,
    150,
    true,
    null,
    true
  );

-- One dance per venue, varied dance types --------------------------------------

-- All three are one-off dances, and the occurrences below are written by hand.
--
-- They used to carry a decorative `recurrence_rule` string ("FREQ=WEEKLY;BYDAY=MO")
-- that no code ever read. Since migration 0009 that column is generated from the
-- recurrence_* columns and a rule means something — a series with a rule
-- materialises nights — so the string had to become either a real recurrence or
-- nothing. Nothing, on purpose: tests/db/proximity.test.ts asserts against these
-- exact rows, and a seeded series whose row count changes with the calendar would
-- make that suite's failures ambiguous. A recurring dance is created by the
-- recurring publish path and by tests/db/occurrenceGenerator.test.ts, both of
-- which make their own.
insert into public.dance_events (id, instructor_id, venue_id, dance_types, price_agorot) values
  (
    'c0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000001',
    array['ריקודי עם', 'זוגות'],
    3000
  ),
  (
    'c0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000002',
    array['ריקודי עם'],
    3500
  ),
  (
    'c0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000003',
    array['ריקודי עם', 'מתחילים'],
    2500
  );

-- One scheduled occurrence per event, a few days out ---------------------------

insert into public.event_occurrences (id, event_id, starts_at, ends_at, status) values
  (
    'd0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    now() + interval '3 days',
    now() + interval '3 days' + interval '3 hours',
    'scheduled'
  ),
  (
    'd0000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000002',
    now() + interval '4 days',
    now() + interval '4 days' + interval '3 hours',
    'scheduled'
  ),
  (
    'd0000000-0000-0000-0000-000000000003',
    'c0000000-0000-0000-0000-000000000003',
    now() + interval '5 days',
    now() + interval '5 days' + interval '3 hours',
    'scheduled'
  );

-- One moved and one cancelled occurrence -------------------------------------
--
-- Added so the three ring states on the hero screen can be checked against real
-- rows instead of mock data. Both are deliberately placed where they cannot
-- disturb tests/db/proximity.test.ts: each sits at (or moves to) the Tel Aviv
-- venue, which that suite's 5km-from-Holon case already asserts is excluded, and
-- both start later than the three scheduled rows above, so the "first result" and
-- 60-day-horizon assertions are untouched.

insert into public.event_occurrences (
  id, event_id, starts_at, ends_at, status, override_venue_id, overridden_at
) values (
  'd0000000-0000-0000-0000-000000000004',
  'c0000000-0000-0000-0000-000000000001',  -- the Holon series...
  now() + interval '6 days',
  now() + interval '6 days' + interval '3 hours',
  'moved',
  'b0000000-0000-0000-0000-000000000002',  -- ...moved to Tel Aviv for one night
  now()
);

-- `overridden_at` is set here, unlike in the first version of this file. Since
-- migration 0010 a night that is not 'scheduled' MUST carry it
-- (event_occurrences_change_is_marked): a cancellation is by definition
-- somebody's decision, and a cancelled row that claims nobody touched it is the
-- state that constraint exists to make unrepresentable.
insert into public.event_occurrences (
  id, event_id, starts_at, ends_at, status, cancellation_reason, overridden_at
) values (
  'd0000000-0000-0000-0000-000000000005',
  'c0000000-0000-0000-0000-000000000002',
  now() + interval '7 days',
  now() + interval '7 days' + interval '3 hours',
  'cancelled',
  'תקלה במזגן באולם',
  now()
);

-- Nationwide recurring seed (Phase 4.0 / 4.0.1) --------------------------------
--
-- Everything above this line is the original fixed-distance fixture
-- tests/db/proximity.test.ts and tests/rls/publishRecurringDance.test.ts assert
-- against — none of it is touched. Everything below is additional, purely to
-- make the hero map and the schedule look like a live national product instead
-- of three dots around Holon: three more instructors, eight more venues, and
-- eleven recurring series (migration 0009's model — typed recurrence_*
-- columns, not a hand-written recurrence_rule) spread across the week, in two
-- groups:
--
--   * A NATIONAL SPREAD: Jerusalem, Haifa, Beer Sheva, Netanya — one venue and
--     one series each, all well outside DEFAULT_RADIUS_METERS of
--     DEFAULT_LAT/LNG (src/lib/domain/defaultRegion.ts, ~15km around Rabin
--     Square), so a dancer reaches them by locating from that city or, once
--     one exists, from a national view — never from the unauthenticated
--     default screen.
--   * A DENSE CENTRAL CLUSTER: Rishon LeZion, Bat Yam, Ramat Gan and Herzliya
--     (new), plus a second series each at the two originally-seeded venues
--     (Holon, Tel Aviv) — all genuinely INSIDE that same 15km, so the map and
--     schedule a dancer sees before granting location, or a real-address
--     dancer sees after, is not three sparse dots. 4.0 kept this radius empty
--     to dodge a handful of e2e/unit assertions that had hardcoded the old,
--     thin roster's exact count and first row; 4.0.1 fixed those assertions
--     instead (see tests/db/proximity.test.ts and tests/e2e/home.spec.ts) so
--     the seed could do its actual job here.
--
-- New id prefixes (f1/f2/f3/f4) so nothing here can collide with a fixed id
-- another suite depends on.
--
-- place_id is left null on these venues, same as the three above: they predate
-- the Google-Places-only insert path 0007 added and are curated rows, not
-- something a client submitted.
--
-- The three new instructors are inserted the same two-step way as the seeded
-- one at the top of this file (auth.users then public.profiles then
-- public.instructors), including the same non-null token columns GoTrue's
-- admin-users scan requires.

insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    'f1000000-0000-0000-0000-000000000001',
    'authenticated', 'authenticated', '+972500000101', now(),
    '', '', '', '',
    '{"provider":"phone","providers":["phone"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f1000000-0000-0000-0000-000000000002',
    'authenticated', 'authenticated', '+972500000102', now(),
    '', '', '', '',
    '{"provider":"phone","providers":["phone"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f1000000-0000-0000-0000-000000000003',
    'authenticated', 'authenticated', '+972500000103', now(),
    '', '', '', '',
    '{"provider":"phone","providers":["phone"]}', '{}', now(), now()
  );

insert into public.profiles (id, display_name, phone) values
  ('f1000000-0000-0000-0000-000000000001', 'אבי שרון', '+972500000101'),
  ('f1000000-0000-0000-0000-000000000002', 'מיכל בר', '+972500000102'),
  ('f1000000-0000-0000-0000-000000000003', 'יוסי אלון', '+972500000103');

insert into public.instructors (id, profile_id, display_name, bio, verified) values
  (
    'f2000000-0000-0000-0000-000000000001',
    'f1000000-0000-0000-0000-000000000001',
    'אבי מרקיד',
    'מרקיד ריקודי עם בצפון ובדרום כבר עשור.',
    true
  ),
  (
    'f2000000-0000-0000-0000-000000000002',
    'f1000000-0000-0000-0000-000000000002',
    'מיכל מרקידה',
    'מרקידה במרכז הארץ, מתמחה בריקודי מתחילים.',
    true
  ),
  (
    'f2000000-0000-0000-0000-000000000003',
    'f1000000-0000-0000-0000-000000000003',
    'יוסי מרקיד',
    'מרקיד ריקודי עם, מארח ערבי ריקוד שבועיים.',
    true
  );

-- National-spread venues: Jerusalem, Haifa, Beer Sheva, Netanya --------------
-- All well outside the ~15km DEFAULT_RADIUS_METERS around Rabin Square
-- (src/lib/domain/defaultRegion.ts) — see the note above.

insert into public.venues (id, name, address, location, capacity, has_parking, is_accessible, has_ac) values
  (
    'f3000000-0000-0000-0000-000000000001',
    'בית שמואל',
    'המ"ג 6, ירושלים',
    extensions.st_setsrid(extensions.st_makepoint(35.2202, 31.7761), 4326)::extensions.geography,
    200,
    true,
    true,
    true
  ),
  (
    'f3000000-0000-0000-0000-000000000002',
    'היכל התרבות חיפה',
    'פל-ים 12, חיפה',
    extensions.st_setsrid(extensions.st_makepoint(34.9896, 32.7940), 4326)::extensions.geography,
    350,
    true,
    true,
    true
  ),
  (
    'f3000000-0000-0000-0000-000000000004',
    'קונסרבטוריון באר שבע',
    'התקוה 65, באר שבע',
    extensions.st_setsrid(extensions.st_makepoint(34.7913, 31.2518), 4326)::extensions.geography,
    180,
    true,
    null,
    true
  ),
  (
    'f3000000-0000-0000-0000-000000000005',
    'היכל התרבות נתניה',
    'שדרות בנימין 1, נתניה',
    extensions.st_setsrid(extensions.st_makepoint(34.8532, 32.3215), 4326)::extensions.geography,
    220,
    false,
    true,
    true
  );

-- Central-cluster venues: Rishon LeZion, Bat Yam, Ramat Gan, Herzliya --------
-- All genuinely inside DEFAULT_RADIUS_METERS of Rabin Square — real
-- coordinates, not nudged to dodge a test (see the header note on why that
-- was true of Rishon LeZion in 4.0 and no longer is).

insert into public.venues (id, name, address, location, capacity, has_parking, is_accessible, has_ac) values
  (
    'f3000000-0000-0000-0000-000000000003',
    'היכל התרבות ראשון לציון',
    'רוטשילד 45, ראשון לציון',
    extensions.st_setsrid(extensions.st_makepoint(34.7925, 31.9730), 4326)::extensions.geography,
    280,
    true,
    true,
    false
  ),
  (
    'f3000000-0000-0000-0000-000000000006',
    'היכל התרבות בת ים',
    'העצמאות 55, בת ים',
    extensions.st_setsrid(extensions.st_makepoint(34.7515, 32.0171), 4326)::extensions.geography,
    240,
    true,
    true,
    true
  ),
  (
    'f3000000-0000-0000-0000-000000000007',
    'היכל התרבות רמת גן',
    'ביאליק 26, רמת גן',
    extensions.st_setsrid(extensions.st_makepoint(34.8248, 32.0684), 4326)::extensions.geography,
    260,
    true,
    true,
    true
  ),
  (
    'f3000000-0000-0000-0000-000000000008',
    'מתנ"ס הרצליה',
    'סוקולוב 42, הרצליה',
    extensions.st_setsrid(extensions.st_makepoint(34.8397, 32.1656), 4326)::extensions.geography,
    200,
    true,
    true,
    false
  );

-- National-spread series: one per city, spread across the week --------------
--
-- Weekday is fixed by recurrence_start_date, not by a separate column (0009):
-- 2024-01-07 is a Sunday, so the four dates below walk Sunday through
-- Thursday. The year is otherwise arbitrary — only the phase (which weekday,
-- and for the biweekly one which week) matters, since the generator counts
-- whole steps forward from this date to today, not from "when this file
-- happened to run".
insert into public.dance_events (
  id, instructor_id, venue_id, dance_types, price_agorot,
  recurrence_freq, recurrence_start_date, recurrence_until_date,
  recurrence_local_start_time, recurrence_local_end_time
) values
  ( -- Jerusalem, Monday, weekly
    'f4000000-0000-0000-0000-000000000001',
    'f2000000-0000-0000-0000-000000000002',
    'f3000000-0000-0000-0000-000000000001',
    array['ריקודי עם', 'מתחילים'],
    2800,
    'weekly', date '2024-01-08', null, time '20:00', time '22:30'
  ),
  ( -- Haifa, Tuesday, weekly
    'f4000000-0000-0000-0000-000000000002',
    'f2000000-0000-0000-0000-000000000001',
    'f3000000-0000-0000-0000-000000000002',
    array['ריקודי עם'],
    3000,
    'weekly', date '2024-01-09', null, time '19:30', time '22:00'
  ),
  ( -- Beer Sheva, Thursday, weekly
    'f4000000-0000-0000-0000-000000000004',
    'f2000000-0000-0000-0000-000000000001',
    'f3000000-0000-0000-0000-000000000004',
    array['ריקודי עם', 'מתקדמים'],
    2600,
    'weekly', date '2024-01-11', null, time '19:00', time '21:30'
  ),
  ( -- Netanya, Sunday, biweekly
    'f4000000-0000-0000-0000-000000000005',
    'f2000000-0000-0000-0000-000000000002',
    'f3000000-0000-0000-0000-000000000005',
    array['ריקודי עם'],
    2400,
    'biweekly', date '2024-01-07', null, time '20:00', time '22:00'
  );

-- Central-cluster series: Rishon LeZion, Bat Yam, Ramat Gan, Herzliya, plus a
-- second series each at the two originally-seeded venues (Holon, Tel Aviv) ---
--
-- Six series, several sharing a weekday with each other or with the national
-- spread on purpose — several halls running the same night is what a real
-- Gush Dan week looks like, not a bug to avoid.
insert into public.dance_events (
  id, instructor_id, venue_id, dance_types, price_agorot,
  recurrence_freq, recurrence_start_date, recurrence_until_date,
  recurrence_local_start_time, recurrence_local_end_time
) values
  ( -- Rishon LeZion, Wednesday, weekly
    'f4000000-0000-0000-0000-000000000003',
    'f2000000-0000-0000-0000-000000000003',
    'f3000000-0000-0000-0000-000000000003',
    array['ריקודי עם', 'זוגות'],
    3200,
    'weekly', date '2024-01-10', null, time '20:30', time '23:00'
  ),
  ( -- Holon, Thursday, weekly — a second series at the originally-seeded venue
    'f4000000-0000-0000-0000-000000000006',
    'a0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000001',
    array['ריקודי עם', 'מתחילים'],
    3000,
    'weekly', date '2024-01-11', null, time '21:00', time '23:00'
  ),
  ( -- Tel Aviv, Tuesday, biweekly — a second series at the originally-seeded venue
    'f4000000-0000-0000-0000-000000000007',
    'a0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000002',
    array['ריקודי עם', 'זוגות'],
    3500,
    'biweekly', date '2024-01-09', null, time '20:00', time '22:30'
  ),
  ( -- Bat Yam, Sunday, weekly
    'f4000000-0000-0000-0000-000000000008',
    'a0000000-0000-0000-0000-000000000002',
    'f3000000-0000-0000-0000-000000000006',
    array['ריקודי עם'],
    2700,
    'weekly', date '2024-01-07', null, time '19:30', time '21:30'
  ),
  ( -- Ramat Gan, Monday, weekly
    'f4000000-0000-0000-0000-000000000009',
    'f2000000-0000-0000-0000-000000000002',
    'f3000000-0000-0000-0000-000000000007',
    array['ריקודי עם', 'מתקדמים'],
    3100,
    'weekly', date '2024-01-08', null, time '20:00', time '22:00'
  ),
  ( -- Herzliya, Thursday, biweekly
    'f4000000-0000-0000-0000-000000000010',
    'f2000000-0000-0000-0000-000000000003',
    'f3000000-0000-0000-0000-000000000008',
    array['ריקודי עם'],
    2900,
    'biweekly', date '2024-01-11', null, time '20:30', time '22:30'
  );

-- Materialises the horizon of nights for the eleven series above, the same
-- function the nightly pg_cron top-up and publish_recurring_dance call
-- (migration 0009). Filtered on recurrence_freq rather than the f4 id range so
-- this keeps working if more recurring series are ever seeded above it. Run as
-- `postgres` during `db reset`, which bypasses the RLS this function would
-- otherwise enforce as the caller (SECURITY INVOKER) — exactly like the
-- pg_cron job does in every other environment.
select public.generate_occurrences_for_event(id)
from public.dance_events
where recurrence_freq is not null;
