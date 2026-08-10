-- 0008 — bound what a venue row may contain, in the DATABASE.
--
-- 0007 is already applied and is not edited here (AGENTS.md §12 / §13).
--
-- The gap. 0007 opened `venues` to any signed-in user and leaned on
-- `buildNewVenue` to keep the contents sane. That was the wrong boundary and the
-- same mistake docs/decisions/0012 records about the near route: the anon key
-- ships in the JavaScript bundle, so a caller with a session reaches
-- `find_or_create_venue` and `POST /rest/v1/venues` directly and never executes a
-- line of our TypeScript. Validation in a Server Action is a UX affordance. The
-- database is the boundary.
--
-- Measured against this stack before writing this migration, from an ordinary
-- phone-OTP session — eight rows landed, every one of them anon-readable:
--
--   place_id ''              accepted   (NOT NULL does not reject the empty string)
--   place_id '   '           accepted
--   name     1000 chars      accepted
--   address  1000 chars      accepted
--   lat 90 / lng 0           accepted   (a dance at the North Pole)
--   lat 30.04 / lng 31.23    accepted   (Cairo)
--
-- Only an empty name was refused, by 0001's own `length(btrim(name)) > 0`. The
-- rest is what this migration closes.
--
-- The numbers below are NOT new. They are the ones `src/lib/domain/newVenue.ts`
-- already used, repeated here because SQL cannot import them:
--
--   MAX_NAME_LENGTH      200
--   MAX_ADDRESS_LENGTH   300
--   MAX_PLACE_ID_LENGTH  512
--   ISRAEL_BOUNDS        lat 29.0 .. 33.5, lng 34.0 .. 36.0
--
-- **These two definitions must move together.** The TypeScript file carries the
-- same warning pointing back here, and `tests/rls/venues.test.ts` asserts the
-- database's limits against the exported TS constants, so drift fails a test
-- rather than quietly leaving one side looser than the other.
--
-- The Israel box is now three expressions of one decision: this constraint, the
-- TS bounds, and `includedRegionCodes: ["il"]` in the autocomplete request.
-- Widening the product beyond Israel means changing all three, and this
-- constraint is the one that actually enforces it.

-- ---------------------------------------------------------------------------
-- place_id
-- ---------------------------------------------------------------------------

-- Nullable, because the seeded venues predate 3.2b and have no place_id. What is
-- rejected is a PRESENT but blank one: `NOT NULL` is satisfied by '', and the
-- unique index treats '' as an ordinary value, so without this a caller could
-- take the empty-string slot and every later blank insert would collide with it.
alter table public.venues
  add constraint venues_place_id_not_blank
  check (place_id is null or length(btrim(place_id)) between 1 and 512);

-- ---------------------------------------------------------------------------
-- name and address
-- ---------------------------------------------------------------------------

-- 0001 already forbids an empty name and an empty address; these add the ceiling
-- it never had. Named separately rather than replacing 0001's constraints, so
-- what each migration contributed stays legible in the schema.
alter table public.venues
  add constraint venues_name_max_length
  check (length(btrim(name)) <= 200);

alter table public.venues
  add constraint venues_address_max_length
  check (length(btrim(address)) <= 300);

-- ---------------------------------------------------------------------------
-- location
-- ---------------------------------------------------------------------------

-- `location` is geography(Point,4326); ST_X/ST_Y are geometry functions, so the
-- cast is required rather than stylistic. Both are IMMUTABLE, which is what lets
-- them appear in a CHECK at all.
--
-- ST_X is the LONGITUDE and ST_Y is the LATITUDE. Saying it here because the
-- whole point of this constraint is catching a transposed pair, and a constraint
-- written with them the wrong way round would accept exactly the rows it exists
-- to reject — Israel's latitude range (29..33.5) and longitude range (34..36) do
-- not overlap, so a swap lands outside both.
--
-- Verified against the three seeded venues before this was added: Tel Aviv,
-- Holon and Eilat all satisfy it, Eilat at 29.5581 being the closest to an edge.
alter table public.venues
  add constraint venues_location_within_israel
  check (
    extensions.st_y(location::extensions.geometry) between 29.0 and 33.5
    and extensions.st_x(location::extensions.geometry) between 34.0 and 36.0
  );

comment on constraint venues_location_within_israel on public.venues is
  'The Israel bounding box, and the enforcing copy of it. The other two are ISRAEL_BOUNDS in src/lib/domain/newVenue.ts and includedRegionCodes in src/lib/maps/placesAutocomplete.ts; all three move together (docs/decisions/0015).';
