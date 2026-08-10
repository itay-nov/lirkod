/**
 * What a client is allowed to claim about a place, checked before it reaches the
 * database.
 *
 * **This is a UX pre-filter, NOT the security boundary.** It runs in the Server
 * Action only, and the anon key ships in the JavaScript bundle — so a caller with
 * a session reaches `find_or_create_venue` and `POST /rest/v1/venues` directly
 * and never executes a line of this file. Measured: before migration 0008, an
 * ordinary phone-OTP session put a 1000-character address and a venue at the
 * North Pole straight into the table.
 *
 * The enforcing copies of every limit below are CHECK constraints in migration
 * 0008. What this file buys is a named field and a Hebrew sentence at the moment
 * of typing, instead of a bare 23514 from Postgres — worth having, and worth
 * nothing as a defence. **The numbers must match 0008 exactly**; they are
 * exported so the RLS suite can assert the database against them and fail on
 * drift.
 *
 * A separate limitation, which no constraint can close: the Google Maps key is
 * HTTP-referrer restricted, so Places can only be called from the browser and the
 * server cannot re-fetch a place to confirm what the client sent
 * (`API_KEY_HTTP_REFERRER_BLOCKED`, measured). A signed-in caller can therefore
 * still post a genuine place_id with a name and position of their choosing —
 * bounded now to a plausible hall inside Israel, but not verified. Closing that
 * needs a second, IP-restricted key so the server can call Places itself; a
 * deployment change, not a code one, and flagged in the ADR.
 *
 * Pure and DOM-free, so it is testable without a browser (AGENTS.md §3).
 */

export interface NewVenueInput {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export type NewVenueField = "placeId" | "name" | "address" | "position";

export interface NewVenueProblem {
  field: NewVenueField;
  reason: "missing" | "tooLong" | "outOfRange";
}

/**
 * **These limits are enforced by the DATABASE, in migration 0008, and the numbers
 * there are copies of these.** They must move together.
 *
 * Exported so `tests/rls/venues.test.ts` can assert the database's behaviour
 * against them directly — a boundary test that fails if either side drifts,
 * which is the only thing that actually keeps two hand-copied definitions in
 * agreement.
 */
export const MAX_NAME_LENGTH = 200;
export const MAX_ADDRESS_LENGTH = 300;

/**
 * Google's place ids are opaque and have grown over the years; this is a
 * generous ceiling rather than a format, because guessing their grammar is how
 * you reject a real place two years from now.
 */
export const MAX_PLACE_ID_LENGTH = 512;

/**
 * A box around Israel, deliberately loose at the edges.
 *
 * One decision, three expressions: this constant, the
 * `venues_location_within_israel` CHECK in migration 0008, and
 * `includedRegionCodes: ["il"]` in `src/lib/maps/placesAutocomplete.ts`. The
 * CHECK is the one that enforces it; the other two are the UI asking nicely.
 * Widening the product beyond Israel means changing all three.
 *
 * Bounds cover the mainland, Eilat in the south and the Golan in the north, with
 * a margin. The cost of being loose is a venue slightly outside a border; the
 * cost of being tight is refusing a real hall, which is worse.
 */
export const ISRAEL_BOUNDS = { minLat: 29.0, maxLat: 33.5, minLng: 34.0, maxLng: 36.0 };

function textProblem(
  field: "placeId" | "name" | "address",
  value: string,
  maxLength: number,
): NewVenueProblem | null {
  const trimmed = value.trim();
  if (trimmed === "") return { field, reason: "missing" };
  if (trimmed.length > maxLength) return { field, reason: "tooLong" };
  return null;
}

export interface NewVenueCommand {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export function buildNewVenue(
  input: NewVenueInput,
): { command: NewVenueCommand } | { problems: NewVenueProblem[] } {
  const problems: NewVenueProblem[] = [];

  const placeIdProblem = textProblem("placeId", input.placeId, MAX_PLACE_ID_LENGTH);
  if (placeIdProblem) problems.push(placeIdProblem);

  const nameProblem = textProblem("name", input.name, MAX_NAME_LENGTH);
  if (nameProblem) problems.push(nameProblem);

  const addressProblem = textProblem("address", input.address, MAX_ADDRESS_LENGTH);
  if (addressProblem) problems.push(addressProblem);

  // NaN and Infinity both fail this, which they must: `location` is NOT NULL and
  // a non-finite coordinate would reach PostGIS as a valid double and produce a
  // point nothing can index.
  const positionIsReal =
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng) &&
    input.lat >= ISRAEL_BOUNDS.minLat &&
    input.lat <= ISRAEL_BOUNDS.maxLat &&
    input.lng >= ISRAEL_BOUNDS.minLng &&
    input.lng <= ISRAEL_BOUNDS.maxLng;

  if (!positionIsReal) problems.push({ field: "position", reason: "outOfRange" });

  if (problems.length > 0) return { problems };

  return {
    command: {
      placeId: input.placeId.trim(),
      name: input.name.trim(),
      address: input.address.trim(),
      lat: input.lat,
      lng: input.lng,
    },
  };
}
