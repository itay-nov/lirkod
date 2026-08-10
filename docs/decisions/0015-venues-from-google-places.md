# 0015 — Venues become self-service, from Google Places

**Status:** accepted
**Builds on:** 0010 (bounded anonymous reads), 0014 (the first authenticated write)

## Context

3.2a let an instructor publish at one of three curated venues. An instructor
whose hall was not among them could not publish at all, which is most of them.
3.2b lets anyone signed in add a hall — but only a hall that exists, and only
once.

## Places API (NEW), not the legacy one

Checked against the configured key before a line was written, and it changed the
implementation:

```
legacy  maps.googleapis.com/maps/api/place/autocomplete/json
        → REQUEST_DENIED, "You're calling a legacy API, which is not enabled"
new     places.googleapis.com/v1/places:autocomplete
        → answers normally
```

So the code uses `AutocompleteSuggestion.fetchAutocompleteSuggestions` and
`Place.fetchFields`, not `AutocompleteService` / `PlacesService`, and the Israel
restriction is spelled `includedRegionCodes: ["il"]` rather than the legacy
`componentRestrictions: { country: "il" }` the task described. Same intent,
different API generation. `src/types/google-maps.d.ts` deliberately declares only
the new classes, so reaching for a legacy one fails to compile rather than
failing in production.

Session tokens are honoured: one token covers every keystroke plus the single
details lookup that ends them, and it is discarded the moment it is spent. Google
prices a session as one unit only if the token is attached to both halves —
getting that wrong is not a correctness bug, which is exactly why it is easy to
miss, and the first version of this code did miss it. See "Session tokens reach
Place Details" below.

## The search moved to the server

3.2a filtered the whole `venues` table in the browser. That was right for three
curated rows and stopped being right the moment anyone could add one: the browser
would have to hold every hall in the country to filter it. Search is now a
bounded query (`searchVenues`, 20 rows) behind `GET /api/venues/search`.

A route handler rather than a Server Action because it fires on keystrokes and
Next serialises Server Actions. A GET rather than the POST that `api/dances/near`
uses, and the contrast is deliberate: that route's body carries a dancer's own
position, which has no business in a URL or an access log, whereas a venue search
is a public directory lookup with nothing personal in it.

## Adding a venue is its own write

Not folded into `publish_dance`, and not for want of the atomicity lesson from
0014. The two cases are different: a dance without its night is a broken record,
while a venue without a dance is a real hall somebody confirmed exists. Clean
venue data is the goal, so a venue that outlives an abandoned publish is a
feature. `publish_dance` is unchanged.

## Dedupe is a database guarantee, not a convention

`venues.place_id` is unique (nullable, so the seeded rows without one coexist).
`find_or_create_venue` does `insert … on conflict (place_id) do nothing` then
selects, in one transaction.

The alternative — select, then insert if absent, from application code — is a
race two instructors adding the same hall at the same second would both win, and
the duplicate this feature exists to prevent is exactly what they would create.
The unique index means even a caller bypassing the RPC cannot duplicate a place;
they get 23505.

First write wins. A later caller with a different name for the same place_id gets
the existing row back rather than overwriting it, so this path cannot be used to
rename or move a hall.

## Attribution

Places predictions are rendered without a Google map anywhere on the screen,
which is the case Google's Places policy requires "Powered by Google" for. The
approved asset is vendored from `maps.gstatic.com` into `public/` rather than
hotlinked or redrawn — recreating the wordmark by hand would mean approximating
someone else's trademark. It renders at its native 120x14, which is the one
element on the screen that does not scale with the user's text size, because its
size is Google's requirement rather than ours.

## RLS: shared, not owned

`venues_insert_authenticated` is `with check (place_id is not null)` — no
ownership clause, deliberately. The hall one instructor adds is the same hall the
next one books; giving the first person edit rights over it would be wrong.

- `anon` gets nothing new. It keeps SELECT, which the map depends on (§2.1), and
  an anonymous insert fails at the privilege layer with 42501.
- The INSERT grant is column-level: `name, address, location, place_id`.
  `capacity`, `has_parking`, `is_accessible` and `has_ac` are withheld because
  0001 is explicit that null there means "we don't know" — letting a client fill
  them in would turn an honest unknown into an unverified claim about wheelchair
  access.
- There is no UPDATE or DELETE policy at all. "Who may correct a shared venue" is
  a moderation question nobody has answered; until then both stay service_role.
- `find_or_create_venue` is SECURITY INVOKER with EXECUTE granted to
  `authenticated` only (`CREATE FUNCTION` grants to PUBLIC by default, so the
  migration revokes first).

**The accepted abuse surface:** any signed-in user can add a venue, so venue spam
is possible. That is the same trust model as "any signed-in user can publish a
dance" (0014), and moderation is a later layer. Accepted, not overlooked.

## The bounds are enforced by the database

### Correction — the first version of this ADR put the boundary in the wrong place

This section originally said `buildNewVenue` "constrains the payload" and treated
that as the mitigation. **It was not a boundary at all.** `buildNewVenue` runs in
the Server Action, and the anon key ships in the JavaScript bundle — so a caller
with an ordinary phone-OTP session reaches `find_or_create_venue` and
`POST /rest/v1/venues` directly and never executes a line of it. The same mistake
docs/decisions/0012 records about the near route, repeated on a write.

Measured against the local stack, from a plain signed-in session, before the fix.
Eight rows landed, every one of them anon-readable:

| input | result before 0008 |
|---|---|
| `place_id` `''` | accepted — `NOT NULL` does not reject the empty string |
| `place_id` `'   '` | accepted |
| 1000-character name | accepted |
| 1000-character address | accepted |
| lat 90 / lng 0 | accepted — a venue at the North Pole |
| lat 30.04 / lng 31.23 | accepted — Cairo |

Only an empty name was refused, by 0001's own `length(btrim(name)) > 0`.

### What migration 0008 adds

CHECK constraints, so every entry point is bounded — the RPC, a direct
PostgREST insert, and anything written later that nobody remembers to route
through the Server Action:

- `venues_place_id_not_blank` — null (the seeded rows) or 1..512 trimmed
- `venues_name_max_length` — ≤ 200 trimmed, on top of 0001's non-empty check
- `venues_address_max_length` — ≤ 300 trimmed
- `venues_location_within_israel` — `ST_Y(location::geometry)` in 29.0..33.5 and
  `ST_X(...)` in 34.0..36.0

The three seeded venues were verified against every one of these before the
constraints were added — Eilat at 29.5581 is the closest to an edge.

`buildNewVenue` stays, demoted to what it always was: a UX pre-filter that names
the offending field in Hebrew instead of surfacing a bare 23514. Its numbers are
copies of the constraint's, it says so, and they are exported so
`tests/rls/venues.test.ts` asserts the database against them — drift fails a test
rather than leaving one side looser.

The Israel box is now **three** expressions of one decision: the CHECK (which
enforces), `ISRAEL_BOUNDS` (which explains), and `includedRegionCodes: ["il"]`
(which asks Google nicely). Widening the product means changing all three, and
each of the three says so.

### What is still not verified

The Maps key is HTTP-referrer restricted, so Places can only be called from the
browser and the server **cannot re-fetch the place**
(`API_KEY_HTTP_REFERRER_BLOCKED`, measured). A signed-in caller can therefore
still pair a genuine place_id with a name and a position of their choosing —
now bounded to a plausible hall inside Israel, but not confirmed to be that hall.

Closing it needs a second, IP-restricted key so the server can call Places
itself. A deployment change, not a code one, and the main outstanding item from
this phase.

## Session tokens reach Place Details

Also corrected after review. The first implementation resolved a selection with
`new Place({ id })`, which returns identical data and **loses the session token**
— so Google bills the details lookup, and every keystroke before it, as separate
requests. Selection now goes through `prediction.toPlace()` on the retained
`PlacePrediction`, which Google has already associated with the session.

Nothing observable changes, which is exactly why it needed a test rather than a
careful reading: `tests/unit/placesAutocomplete.test.ts` mocks the Places objects
and asserts that the details call came from the prediction and that `new Place`
was never constructed. Reverting the fix fails three of its cases.

## PostGIS

The point is built inside the function from lat/lng —
`ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography` — rather than accepted
as WKT, so the SRID cannot be wrong and the argument order lives in one place.
`ST_MakePoint` takes (x, y) = (longitude, latitude), the reverse of how everyone
says it aloud, and getting it backwards puts every Israeli venue in the Indian
Ocean.

Verified end to end rather than by inspection: a hall added through the real
Places UI stored `POINT(34.7798 32.0732)`, SRID 4326, and a dance published there
came back to an **anonymous** `find_dances_near` within a 500m radius with the
same coordinates, and rendered on `/schedule` for a visitor with no cookies. The
RLS suite pins the same claim with a 300m radius, and a unit test rejects a
swapped lat/lng — Israel's latitude and longitude ranges do not overlap, so a
transposed pair falls outside the box.
