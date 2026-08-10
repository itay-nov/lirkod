import { describe, expect, it } from "vitest";
import { buildNewVenue, type NewVenueInput } from "@/lib/domain/newVenue";

/** בית ציוני אמריקה, exactly as Google returned it during the STEP 0 probe. */
function input(overrides: Partial<NewVenueInput> = {}): NewVenueInput {
  return {
    placeId: "ChIJC2tyo4NLHRUR9qPh_LUAix4",
    name: "בית ציוני אמריקה",
    address: "דניאל פריש 1, תל אביב-יפו",
    lat: 32.0744862,
    lng: 34.782322,
    ...overrides,
  };
}

function commandOf(overrides: Partial<NewVenueInput> = {}) {
  const result = buildNewVenue(input(overrides));
  if ("problems" in result) {
    throw new Error(`expected a command, got ${JSON.stringify(result.problems)}`);
  }
  return result.command;
}

function problemsOf(overrides: Partial<NewVenueInput> = {}) {
  const result = buildNewVenue(input(overrides));
  if ("command" in result) throw new Error("expected problems, got a command");
  return result.problems;
}

describe("buildNewVenue", () => {
  it("accepts a real place from Places", () => {
    expect(commandOf()).toEqual({
      placeId: "ChIJC2tyo4NLHRUR9qPh_LUAix4",
      name: "בית ציוני אמריקה",
      address: "דניאל פריש 1, תל אביב-יפו",
      lat: 32.0744862,
      lng: 34.782322,
    });
  });

  it("trims the text but leaves the coordinates untouched", () => {
    const command = commandOf({ name: "  היכל התרבות  ", address: " ויצמן 24 " });
    expect(command.name).toBe("היכל התרבות");
    expect(command.address).toBe("ויצמן 24");
    expect(command.lat).toBe(32.0744862);
  });

  it.each([
    [{ placeId: "" }, "placeId"],
    [{ placeId: "   " }, "placeId"],
    [{ name: "" }, "name"],
    [{ address: "" }, "address"],
  ])("names the empty field %o", (overrides, field) => {
    expect(problemsOf(overrides)).toEqual([{ field, reason: "missing" }]);
  });

  it("refuses absurdly long text rather than handing it to the database", () => {
    expect(problemsOf({ name: "א".repeat(201) })).toEqual([
      { field: "name", reason: "tooLong" },
    ]);
    expect(problemsOf({ address: "א".repeat(301) })).toEqual([
      { field: "address", reason: "tooLong" },
    ]);
    expect(problemsOf({ placeId: "x".repeat(513) })).toEqual([
      { field: "placeId", reason: "tooLong" },
    ]);
  });

  describe("the position", () => {
    it.each([
      ["Eilat", 29.5581, 34.9482],
      ["the Golan", 33.2, 35.7],
      ["Tel Aviv", 32.0853, 34.7818],
      ["Beersheba", 31.2518, 34.7913],
    ])("accepts %s", (_where, lat, lng) => {
      expect(commandOf({ lat, lng }).lat).toBe(lat);
    });

    it.each([
      ["Cyprus", 35.1264, 33.4299],
      ["Cairo", 30.0444, 31.2357],
      ["the North Pole", 90, 0],
      ["null island", 0, 0],
    ])("refuses %s — outside the Israel bounds", (_where, lat, lng) => {
      expect(problemsOf({ lat, lng })).toEqual([{ field: "position", reason: "outOfRange" }]);
    });

    it.each([
      ["NaN latitude", Number.NaN, 34.78],
      ["Infinite longitude", 32.08, Number.POSITIVE_INFINITY],
      ["-Infinity", Number.NEGATIVE_INFINITY, 34.78],
    ])("refuses %s", (_what, lat, lng) => {
      // `location` is NOT NULL and PostGIS would happily store a non-finite
      // double as a point nothing can index.
      expect(problemsOf({ lat, lng })).toEqual([{ field: "position", reason: "outOfRange" }]);
    });

    it("does not silently swap latitude and longitude", () => {
      // Israel's lat and lng ranges overlap (29-33.5 vs 34-36), so a swapped
      // pair for Tel Aviv lands outside both. This is the mistake that would put
      // every venue in the wrong hemisphere-ish, and it must be caught, not
      // guessed at and "fixed".
      expect(problemsOf({ lat: 34.7818, lng: 32.0853 })).toEqual([
        { field: "position", reason: "outOfRange" },
      ]);
    });
  });

  it("reports every problem at once, so one round trip names them all", () => {
    expect(problemsOf({ placeId: "", name: "", address: "", lat: 0, lng: 0 })).toHaveLength(4);
  });
});
