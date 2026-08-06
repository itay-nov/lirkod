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
insert into auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a0000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  '+972500000100',
  now(),
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

insert into public.dance_events (id, instructor_id, venue_id, dance_types, recurrence_rule, price_agorot) values
  (
    'c0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000001',
    array['ריקודי עם', 'זוגות'],
    'FREQ=WEEKLY;BYDAY=MO',
    3000
  ),
  (
    'c0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000002',
    array['ריקודי עם'],
    'FREQ=WEEKLY;BYDAY=WE',
    3500
  ),
  (
    'c0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000002',
    'b0000000-0000-0000-0000-000000000003',
    array['ריקודי עם', 'מתחילים'],
    'FREQ=WEEKLY;BYDAY=TH',
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

insert into public.event_occurrences (
  id, event_id, starts_at, ends_at, status, cancellation_reason
) values (
  'd0000000-0000-0000-0000-000000000005',
  'c0000000-0000-0000-0000-000000000002',
  now() + interval '7 days',
  now() + interval '7 days' + interval '3 hours',
  'cancelled',
  'תקלה במזגן באולם'
);
