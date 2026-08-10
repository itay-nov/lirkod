import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAutocompleteSession } from "@/lib/maps/placesAutocomplete";

/**
 * The session-token lifecycle, which is a BILLING contract rather than a
 * behavioural one — and that is exactly why it needs a test.
 *
 * Google charges an autocomplete session as one unit only when the same token
 * covers the keystrokes and the single Place Details call that ends them. Get it
 * wrong and nothing breaks: the same suggestions appear, the same place comes
 * back, the same venue is created. The only visible difference is on the invoice
 * a month later, which no amount of manual testing surfaces.
 *
 * The specific regression pinned here: resolving a selection with
 * `new Place({ id })` instead of `prediction.toPlace()`. Both return identical
 * data. Only the second carries the session.
 *
 * `loadGoogleMaps` is mocked because it appends a script tag to a document that
 * does not exist here; everything else is a stand-in for Google's own objects,
 * shaped to record which path was taken.
 */

vi.mock("@/lib/maps/loadGoogleMaps", () => ({
  loadGoogleMaps: vi.fn(async () => undefined),
}));

interface Calls {
  fetchAutocompleteSuggestions: Array<{ input: string; sessionToken: unknown }>;
  toPlace: number;
  newPlace: number;
  fetchFields: Array<{ from: "prediction" | "constructor"; fields: string[] }>;
}

let calls: Calls;

class FakeSessionToken {}

function fakePlace(origin: "prediction" | "constructor", id: string) {
  return {
    id,
    displayName: "בית ציוני אמריקה",
    formattedAddress: "דניאל פריש 1, תל אביב-יפו",
    location: { lat: () => 32.0744862, lng: () => 34.782322 },
    async fetchFields(request: { fields: string[] }) {
      calls.fetchFields.push({ from: origin, fields: request.fields });
      return { place: this };
    },
  };
}

function fakePrediction(id: string, text: string) {
  return {
    placeId: id,
    text: { toString: () => text },
    toPlace() {
      calls.toPlace += 1;
      return fakePlace("prediction", id);
    },
  };
}

beforeEach(() => {
  calls = {
    fetchAutocompleteSuggestions: [],
    toPlace: 0,
    newPlace: 0,
    fetchFields: [],
  };

  const places = {
    AutocompleteSessionToken: FakeSessionToken,
    AutocompleteSuggestion: {
      async fetchAutocompleteSuggestions(request: {
        input: string;
        sessionToken?: unknown;
      }) {
        calls.fetchAutocompleteSuggestions.push({
          input: request.input,
          sessionToken: request.sessionToken,
        });
        return {
          suggestions: [
            { placePrediction: fakePrediction("place-1", "בית ציוני אמריקה, תל אביב") },
            { placePrediction: fakePrediction("place-2", "היכל התרבות, תל אביב") },
            // Google does return non-place suggestions (query predictions); they
            // have no placeId and must be dropped rather than crash the mapper.
            { placePrediction: null },
          ],
        };
      },
    },
    Place: class {
      constructor() {
        calls.newPlace += 1;
      }
    },
  };

  vi.stubGlobal("google", {
    maps: { importLibrary: async () => places },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the autocomplete session", () => {
  it("sends one token with every suggestion call", async () => {
    const session = await startAutocompleteSession("key");

    await session.suggest("בית");
    await session.suggest("בית ציוני");
    await session.suggest("בית ציוני אמריקה");

    expect(calls.fetchAutocompleteSuggestions).toHaveLength(3);
    const tokens = calls.fetchAutocompleteSuggestions.map((call) => call.sessionToken);
    expect(tokens[0]).toBeInstanceOf(FakeSessionToken);
    // The same object, not merely an equal one — a new token per keystroke is
    // precisely the per-request billing this exists to prevent.
    expect(new Set(tokens).size).toBe(1);
  });

  it("resolves a selection through the prediction, never a fresh Place", async () => {
    const session = await startAutocompleteSession("key");
    await session.suggest("בית ציוני");

    const selected = await session.select("place-1");

    // THE assertion. `new Place({ id })` returns the same data and loses the
    // session, so this is the only thing standing between us and a bill per
    // keystroke.
    expect(calls.toPlace).toBe(1);
    expect(calls.newPlace).toBe(0);
    expect(calls.fetchFields).toEqual([
      {
        from: "prediction",
        fields: ["id", "displayName", "formattedAddress", "location"],
      },
    ]);

    expect(selected).toEqual({
      placeId: "place-1",
      name: "בית ציוני אמריקה",
      address: "דניאל פריש 1, תל אביב-יפו",
      lat: 32.0744862,
      lng: 34.782322,
    });
  });

  it("asks Google for exactly the four fields a venue row stores", async () => {
    // The field mask is what a details call is priced on, so a wider one is
    // paying for data with nowhere to go.
    const session = await startAutocompleteSession("key");
    await session.suggest("בית ציוני");
    await session.select("place-1");

    expect(calls.fetchFields[0]?.fields).toEqual([
      "id",
      "displayName",
      "formattedAddress",
      "location",
    ]);
  });

  it("refuses an id this session never suggested", async () => {
    const session = await startAutocompleteSession("key");
    await session.suggest("בית ציוני");

    // The tempting fallback — build a `Place` from the id and fetch it anyway —
    // is the bug in a different costume: it works, and it leaves the token
    // behind.
    await expect(session.select("place-never-seen")).resolves.toBeNull();
    expect(calls.newPlace).toBe(0);
    expect(calls.fetchFields).toHaveLength(0);
  });

  it("spends the session on selection, so it cannot be reused", async () => {
    const session = await startAutocompleteSession("key");
    await session.suggest("בית ציוני");
    await session.select("place-1");

    // A reused token would bill the next search's keystrokes against a session
    // Google has already closed.
    await session.suggest("היכל");
    const afterSelect = calls.fetchAutocompleteSuggestions.at(-1);
    expect(afterSelect?.sessionToken).toBeUndefined();
  });

  it("drops suggestions that carry no place, rather than crashing on them", async () => {
    const session = await startAutocompleteSession("key");

    const suggestions = await session.suggest("בית");

    expect(suggestions).toEqual([
      { placeId: "place-1", text: "בית ציוני אמריקה, תל אביב" },
      { placeId: "place-2", text: "היכל התרבות, תל אביב" },
    ]);
  });

  it("does not call Google for one or two characters", async () => {
    // Google bills any non-empty input, and two letters cannot name a hall.
    const session = await startAutocompleteSession("key");

    expect(await session.suggest("ב")).toEqual([]);
    expect(await session.suggest("  ")).toEqual([]);
    expect(calls.fetchAutocompleteSuggestions).toHaveLength(0);
  });
});
