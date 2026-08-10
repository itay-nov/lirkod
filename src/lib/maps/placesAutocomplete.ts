/**
 * Google Places Autocomplete, wrapped so the venue form deals in "suggest halls
 * near this text" and "tell me where that one is".
 *
 * **Places API (New), not the legacy one.** Checked against the configured key
 * before this was written: the legacy endpoints answer
 * "You're calling a legacy API, which is not enabled for your project", while
 * the new one answers normally. So this uses `AutocompleteSuggestion` and
 * `Place.fetchFields`, not `AutocompleteService` / `PlacesService`, and the
 * Israel restriction is spelled `includedRegionCodes: ["il"]` rather than the
 * legacy `componentRestrictions: { country: "il" }`. Same intent, different
 * spelling — worth knowing if you are following an older tutorial.
 *
 * **Browser-only, by necessity as well as convention.** The key is
 * HTTP-referrer restricted, so a call from the server is refused outright
 * (`API_KEY_HTTP_REFERRER_BLOCKED`, measured). That is also why the server
 * cannot re-verify what this module returns — see the note in
 * `src/lib/domain/newVenue.ts` about what is done instead.
 *
 * Loads through the same `loadGoogleMaps` memo the map uses, so a dancer who has
 * already seen the map pays nothing for the script here (AGENTS.md §2.9).
 */

import { loadGoogleMaps } from "./loadGoogleMaps";

export interface PlaceSuggestion {
  /** Stable across the session; what `selectPlace` is called back with. */
  placeId: string;
  /** "בית ציוני אמריקה, דניאל פריש, תל אביב-יפו" — the whole line, for display. */
  text: string;
}

export interface SelectedPlace {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

/**
 * One autocomplete "session": every keystroke plus the single details lookup for
 * whatever the user picks.
 *
 * Google bills a session as one unit rather than per keystroke, but ONLY if the
 * same session token is attached to the suggestion calls and to the details call
 * that ends them. Getting this wrong is not a correctness bug — everything still
 * works — it is a billing one, which is exactly the kind that goes unnoticed. The
 * token is therefore owned here rather than by the component, and is discarded
 * the moment it is spent.
 */
export interface AutocompleteSession {
  suggest(input: string): Promise<PlaceSuggestion[]>;
  /**
   * Resolves the place and ENDS the session — the token is spent, so this
   * session must be replaced before the next search. Returns null if Google has
   * no detail for the id.
   */
  select(placeId: string): Promise<SelectedPlace | null>;
}

/**
 * Israel only, for now — and this is the weakest of the three copies of that
 * decision, because it is a request parameter a forged call simply omits. The
 * enforcing one is the `venues_location_within_israel` CHECK in migration 0008;
 * `ISRAEL_BOUNDS` in `src/lib/domain/newVenue.ts` is the third. All three move
 * together.
 */
const REGION_CODES = ["il"];

const LANGUAGE = "he";

export async function startAutocompleteSession(
  apiKey: string,
): Promise<AutocompleteSession> {
  await loadGoogleMaps(apiKey);
  const places = await google.maps.importLibrary("places");
  const { AutocompleteSessionToken, AutocompleteSuggestion } = places;

  let token: google.maps.places.AutocompleteSessionToken | undefined =
    new AutocompleteSessionToken();

  /**
   * The `PlacePrediction` objects behind the suggestions we last handed out.
   *
   * Retained because the session token only reaches Place Details through them.
   * `prediction.toPlace()` returns a `Place` that Google has already associated
   * with this session; `new Place({ id })` does not, so a details call built that
   * way is billed as a standalone request and every keystroke before it becomes
   * separately billable too. Both spellings work and return identical data, which
   * is exactly why the wrong one survives review — the only visible difference is
   * on the invoice.
   */
  const predictions = new Map<string, google.maps.places.PlacePrediction>();

  return {
    async suggest(input: string): Promise<PlaceSuggestion[]> {
      const query = input.trim();
      // Google bills a request for any non-empty input, and one or two
      // characters cannot produce a useful hall name anyway.
      if (query.length < 2) return [];

      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: query,
        includedRegionCodes: REGION_CODES,
        language: LANGUAGE,
        region: REGION_CODES[0],
        sessionToken: token,
      });

      // Replaced rather than accumulated: only the latest set is selectable, and
      // holding every prediction from every keystroke would pin objects Google
      // considers stale.
      predictions.clear();

      return suggestions.flatMap((suggestion) => {
        const prediction = suggestion.placePrediction;
        if (!prediction?.placeId) return [];
        predictions.set(prediction.placeId, prediction);
        return [{ placeId: prediction.placeId, text: prediction.text.toString() }];
      });
    },

    async select(placeId: string): Promise<SelectedPlace | null> {
      const prediction = predictions.get(placeId);
      // Nothing to select against means the caller passed an id this session
      // never suggested. Refused rather than fetched with a fresh `Place`,
      // because that would silently leave the session token behind and turn the
      // whole search into per-request billing.
      if (!prediction) return null;

      const place = prediction.toPlace();

      // Exactly the four fields the venue row needs. The field mask is what
      // Google prices a details call on, so asking for more than is stored would
      // be paying for data with nowhere to go (AGENTS.md §8, same instinct).
      await place.fetchFields({
        fields: ["id", "displayName", "formattedAddress", "location"],
      });

      // Spent: the token covered every suggestion above plus this one lookup, and
      // reusing it would silently start billing per keystroke.
      token = undefined;
      predictions.clear();

      const location = place.location;
      if (!place.id || !place.displayName || !place.formattedAddress || !location) {
        return null;
      }

      return {
        placeId: place.id,
        name: place.displayName,
        address: place.formattedAddress,
        lat: location.lat(),
        lng: location.lng(),
      };
    },
  };
}
