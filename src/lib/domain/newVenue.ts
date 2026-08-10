/**
 * What a client is allowed to claim about a place, checked before it reaches the
 * database.
 *
 * This exists because of a limitation worth stating plainly. The Google Maps key
 * is HTTP-referrer restricted, so Places can only be called from the browser —
 * a server-side Details call with the same key is refused
 * (`API_KEY_HTTP_REFERRER_BLOCKED`, measured). The server therefore cannot
 * re-fetch the place to confirm what the client sent, which is the usual answer
 * to AGENTS.md §8's "never trust what arrived from the client".
 *
 * So the fields are constrained instead of verified. That is weaker, and the
 * gap is real: a signed-in caller can post a genuine place_id with a name and a
 * position of their choosing. It is the same class of abuse as venue spam, which
 * docs/decisions/0015 accepts for v1 — but "accepted" is not "unbounded", and
 * the bounds below are what keep a forged payload to a plausible-looking hall in
 * Israel rather than a venue at the North Pole called 4MB of text.
 *
 * Closing it properly needs a second, IP-restricted key so the server can call
 * Places itself. That is a deployment change, not a code one, and it is flagged
 * in the ADR.
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

/** Matches `length(btrim(name)) > 0` and the address check in migration 0001. */
const MAX_NAME_LENGTH = 200;
const MAX_ADDRESS_LENGTH = 300;

/**
 * Google's place ids are opaque and have grown over the years; this is a
 * generous ceiling rather than a format, because guessing their grammar is how
 * you reject a real place two years from now.
 */
const MAX_PLACE_ID_LENGTH = 512;

/**
 * A box around Israel, deliberately loose at the edges.
 *
 * It is the server-side twin of the `includedRegionCodes: ["il"]` restriction
 * the autocomplete field sends: without it, that restriction is a UI preference
 * a forged request simply omits. Widening the product beyond Israel means
 * widening BOTH — they are one decision expressed twice, which is why this
 * comment names the other one.
 *
 * Bounds cover the mainland, Eilat in the south and the Golan in the north, with
 * a margin. The cost of being loose is a venue slightly outside a border; the
 * cost of being tight is refusing a real hall, which is worse.
 */
const ISRAEL_BOUNDS = { minLat: 29.0, maxLat: 33.5, minLng: 34.0, maxLng: 36.0 };

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
