import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, signInAs, type Client } from "./helpers";
import {
  ISRAEL_BOUNDS,
  MAX_ADDRESS_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLACE_ID_LENGTH,
} from "@/lib/domain/newVenue";

/**
 * The venue write path added in 3.2b (migration 0007, docs/decisions/0015).
 *
 * `venues` is the first table in this schema that a signed-in user may write to
 * WITHOUT owning the row, so the usual ownership assertions do not apply and the
 * interesting questions are different ones: can anon write (no), must a venue be
 * a real place (yes), can the same place land twice (no), and does what an
 * instructor adds reach a dancer with no account (yes).
 *
 * Its own phone number, because `[auth.sms] max_frequency` is keyed on it
 * (docs/decisions/0013).
 */

const PHONE = "+972500000010";
const FIXTURE_PREFIX = "venue-test-";

/** A real Places id shape, but ours — no test should depend on Google's data. */
const PLACE_ID = `${FIXTURE_PREFIX}ChIJ0000000000000000000000`;

/** Tel Aviv. Latitude 32, longitude 34 — in that order everywhere but ST_MakePoint. */
const LAT = 32.0853;
const LNG = 34.7818;

let service: Client;
let anon: Client;
let member: Client;

async function cleanUp(): Promise<void> {
  const { data: venues } = await service
    .from("venues")
    .select("id")
    .like("place_id", `${FIXTURE_PREFIX}%`);

  const venueIds = (venues ?? []).map((venue) => venue.id);
  if (venueIds.length > 0) {
    const { data: events } = await service
      .from("dance_events")
      .select("id")
      .in("venue_id", venueIds);
    const eventIds = (events ?? []).map((event) => event.id);
    if (eventIds.length > 0) {
      await service.from("event_occurrences").delete().in("event_id", eventIds);
      await service.from("dance_events").delete().in("id", eventIds);
    }
    await service.from("venues").delete().in("id", venueIds);
  }

  const { data: users } = await service.auth.admin.listUsers();
  for (const user of users?.users ?? []) {
    if (user.phone === PHONE.replace("+", "")) {
      await service.auth.admin.deleteUser(user.id);
    }
  }
}

beforeAll(async () => {
  service = serviceClient();
  await cleanUp();
  anon = anonClient();
  member = await signInAs(PHONE);
});

afterAll(async () => {
  await cleanUp();
});

/** The RPC the app calls; `place_id` doubles as this suite's fixture marker. */
function addVenue(client: Client, overrides: Record<string, unknown> = {}) {
  return client.rpc("find_or_create_venue", {
    p_place_id: PLACE_ID,
    p_name: `${FIXTURE_PREFIX}אולם`,
    p_address: "רחוב הבדיקה 1, תל אביב",
    p_lat: LAT,
    p_lng: LNG,
    ...overrides,
  });
}

describe("adding a venue", () => {
  it("lets any signed-in user add one — venues are shared, not owned", async () => {
    // `member` is a plain signed-in phone number: no profile row, no instructor
    // row, nothing. That is the whole authorisation model for this table, and
    // asserting it from the barest possible session is the point.
    const { data, error } = await addVenue(member).single();

    expect(error).toBeNull();
    expect(data?.name).toBe(`${FIXTURE_PREFIX}אולם`);
  });

  it("refuses an anonymous caller at the privilege layer", async () => {
    const { error } = await addVenue(anon, { p_place_id: `${FIXTURE_PREFIX}anon` });

    // EXECUTE was revoked from PUBLIC and granted to `authenticated` only
    // (migration 0007). CREATE FUNCTION grants to PUBLIC by default, so this
    // passing is what proves the REVOKE is present and doing something.
    expect(error?.code).toBe("42501");
    expect(error?.message ?? "").toContain("find_or_create_venue");
  });

  it("refuses an anonymous direct insert too, not just the RPC", async () => {
    // The function is convenience; the table is the boundary. `anon` holds
    // SELECT and nothing else, so this dies before RLS is consulted.
    const { error } = await anon.from("venues").insert({
      name: `${FIXTURE_PREFIX}anon-direct`,
      address: "רחוב האסור 1",
      location: `POINT(${LNG} ${LAT})`,
      place_id: `${FIXTURE_PREFIX}anon-direct`,
    });

    expect(error?.code).toBe("42501");
  });

  it("refuses a signed-in insert with no place_id — a venue must be a real place", async () => {
    // venues_insert_authenticated's WITH CHECK. Without it this table would
    // become free text, and dedupe would have nothing to key on.
    const { error } = await member.from("venues").insert({
      name: `${FIXTURE_PREFIX}no-place`,
      address: "רחוב בלי מזהה 1",
      location: `POINT(${LNG} ${LAT})`,
    });

    expect(error).not.toBeNull();

    const { data } = await service
      .from("venues")
      .select("id")
      .eq("name", `${FIXTURE_PREFIX}no-place`);
    expect(data ?? []).toHaveLength(0);
  });

  it("refuses a signed-in caller writing a curated column", async () => {
    // capacity/is_accessible are outside the column grant. 0001 is explicit that
    // null there means "we don't know" — letting a client fill it in would turn
    // an honest unknown into an unverified claim about wheelchair access.
    const { error } = await member.from("venues").insert({
      name: `${FIXTURE_PREFIX}curated`,
      address: "רחוב הקיבולת 1",
      location: `POINT(${LNG} ${LAT})`,
      place_id: `${FIXTURE_PREFIX}curated`,
      is_accessible: true,
    });

    expect(error?.code).toBe("42501");
  });
});

describe("dedupe by place_id", () => {
  it("survives two callers adding the same hall at the same moment", async () => {
    // Concurrent, not sequential. A sequential pair proves only that the second
    // caller reads what the first wrote; the failure this guards is the LOSING
    // caller erroring instead of getting the row back, which a sequential test
    // cannot produce because there is never a race to lose.
    const [first, second] = await Promise.all([
      addVenue(member).single(),
      addVenue(member, {
        p_name: `${FIXTURE_PREFIX}אותו אולם בשם אחר`,
        p_lat: 31.9,
        p_lng: 34.8,
      }).single(),
    ]);

    // BOTH succeed. Whichever loses the insert falls through to the select and
    // comes back with the winner's row.
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data?.id).toBe(first.data?.id);

    // Exactly one row, and the first write's contents: `on conflict do nothing`
    // does not overwrite, so a later caller cannot rename or move a hall here.
    const { data: rows } = await service
      .from("venues")
      .select("id, name")
      .eq("place_id", PLACE_ID);
    expect(rows ?? []).toHaveLength(1);
    expect([`${FIXTURE_PREFIX}אולם`, `${FIXTURE_PREFIX}אותו אולם בשם אחר`]).toContain(
      rows?.[0]?.name,
    );
  });

  it("is enforced by the database, not only by the function", async () => {
    // A direct insert bypassing the RPC still cannot duplicate the place. This
    // is the unique index, and it is what makes dedupe a guarantee rather than a
    // convention the next writer might not follow.
    const { error } = await member.from("venues").insert({
      name: `${FIXTURE_PREFIX}duplicate`,
      address: "רחוב הכפילות 1",
      location: `POINT(${LNG} ${LAT})`,
      place_id: PLACE_ID,
    });

    expect(error?.code).toBe("23505");
  });
});

/**
 * The bounds live in the DATABASE (migration 0008), and this block is why.
 *
 * `buildNewVenue` runs in the Server Action only. The anon key ships in the
 * JavaScript bundle, so a caller with a session reaches the RPC and PostgREST
 * directly and never executes it — measured before 0008: empty place_id, a
 * 1000-character address and a venue at the North Pole all landed, and every one
 * of them was anon-readable.
 *
 * Every case below is therefore run through BOTH doors. The limits are imported
 * from the TypeScript module rather than retyped, so if the two definitions ever
 * drift this suite fails instead of leaving one side quietly looser.
 */
describe("the database bounds what a venue may contain", () => {
  const HOSTILE: ReadonlyArray<{
    what: string;
    place_id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
  }> = [
    { what: "an empty place_id", place_id: "", name: "אולם", address: "רחוב 1", lat: LAT, lng: LNG },
    {
      what: "a whitespace-only place_id",
      place_id: "   ",
      name: "אולם",
      address: "רחוב 1",
      lat: LAT,
      lng: LNG,
    },
    {
      what: "a place_id past the ceiling",
      place_id: "x".repeat(MAX_PLACE_ID_LENGTH + 1),
      name: "אולם",
      address: "רחוב 1",
      lat: LAT,
      lng: LNG,
    },
    { what: "an empty name", place_id: `${FIXTURE_PREFIX}h1`, name: "", address: "רחוב 1", lat: LAT, lng: LNG },
    {
      what: "a whitespace-only name",
      place_id: `${FIXTURE_PREFIX}h2`,
      name: "   ",
      address: "רחוב 1",
      lat: LAT,
      lng: LNG,
    },
    {
      what: "a name past the ceiling",
      place_id: `${FIXTURE_PREFIX}h3`,
      name: "א".repeat(MAX_NAME_LENGTH + 1),
      address: "רחוב 1",
      lat: LAT,
      lng: LNG,
    },
    {
      what: "an address past the ceiling",
      place_id: `${FIXTURE_PREFIX}h4`,
      name: "אולם",
      address: "א".repeat(MAX_ADDRESS_LENGTH + 1),
      lat: LAT,
      lng: LNG,
    },
    {
      what: "the North Pole (lat 90, lng 0)",
      place_id: `${FIXTURE_PREFIX}h5`,
      name: "אולם",
      address: "רחוב 1",
      lat: 90,
      lng: 0,
    },
    {
      what: "Cairo",
      place_id: `${FIXTURE_PREFIX}h6`,
      name: "אולם",
      address: "רחוב 1",
      lat: 30.0444,
      lng: 31.2357,
    },
    {
      what: "a latitude just past the northern bound",
      place_id: `${FIXTURE_PREFIX}h7`,
      name: "אולם",
      address: "רחוב 1",
      lat: ISRAEL_BOUNDS.maxLat + 0.1,
      lng: LNG,
    },
    {
      what: "a transposed lat/lng for Tel Aviv",
      place_id: `${FIXTURE_PREFIX}h8`,
      name: "אולם",
      address: "רחוב 1",
      lat: LNG,
      lng: LAT,
    },
  ];

  it.each(HOSTILE)("refuses $what through the RPC", async (row) => {
    const { error } = await member.rpc("find_or_create_venue", {
      p_place_id: row.place_id,
      p_name: row.name,
      p_address: row.address,
      p_lat: row.lat,
      p_lng: row.lng,
    });

    // 23514 — a CHECK constraint. Specifically not "some error": a 42501 here
    // would mean a privilege happened to save us rather than the bound holding.
    expect(error?.code).toBe("23514");
  });

  it.each(HOSTILE)("refuses $what through a direct insert", async (row) => {
    const { error } = await member.from("venues").insert({
      place_id: row.place_id,
      name: row.name,
      address: row.address,
      location: `POINT(${row.lng} ${row.lat})`,
    });

    expect(error).not.toBeNull();
    expect(["23514", "22P02"]).toContain(error?.code);
  });

  it("leaves nothing behind for an anonymous reader", async () => {
    // The consequence that made this a Medium rather than a nitpick: a venue row
    // is world-readable, so a rejected write that silently succeeded would be
    // published to every visitor.
    const { data } = await anon
      .from("venues")
      .select("id")
      .like("place_id", `${FIXTURE_PREFIX}h%`);

    expect(data ?? []).toHaveLength(0);
  });

  it("accepts the values exactly at the limits, so the bounds are not off by one", async () => {
    // The other half of a boundary test. Without it, a constraint that rejected
    // everything would pass every assertion above.
    const { error } = await member.rpc("find_or_create_venue", {
      p_place_id: `${FIXTURE_PREFIX}edge`,
      p_name: "א".repeat(MAX_NAME_LENGTH),
      p_address: "א".repeat(MAX_ADDRESS_LENGTH),
      p_lat: ISRAEL_BOUNDS.maxLat,
      p_lng: ISRAEL_BOUNDS.maxLng,
    });

    expect(error).toBeNull();
  });
});

describe("what an instructor adds, a dancer with no account can see", () => {
  it("is anon-selectable, with its name and address", async () => {
    await addVenue(member).single();

    const { data, error } = await anon
      .from("venues")
      .select("id, name, address")
      .eq("place_id", PLACE_ID)
      .single();

    // The map names the venue to signed-out visitors (AGENTS.md §2.1); a venue
    // only instructors could see would be useless.
    expect(error).toBeNull();
    expect(data?.name).toBe(`${FIXTURE_PREFIX}אולם`);
  });

  it("carries a PostGIS point a proximity search actually finds", async () => {
    // The end-to-end claim of 3.2b: a dance at a hall added through Places has
    // to reach the public map. Anything less than a real find_dances_near call
    // would leave the coordinate order untested — and ST_MakePoint takes
    // (longitude, latitude), so getting it backwards puts an Israeli hall in the
    // Indian Ocean while every other assertion in this file still passes.
    const { data: venue } = await addVenue(member).single();
    const venueId = venue!.id;

    const { data: user } = await member.auth.getUser();
    const profileId = user.user!.id;

    await member
      .from("profiles")
      .insert({ id: profileId, display_name: "בודקת מקומות", phone: PHONE });
    const { data: instructor } = await member
      .from("instructors")
      .insert({ profile_id: profileId, display_name: `${FIXTURE_PREFIX}מרקידה` })
      .select("id")
      .single();

    const soon = (days: number, hourUtc: number): string => {
      const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      at.setUTCHours(hourUtc, 0, 0, 0);
      return at.toISOString();
    };

    const { error: publishError } = await member
      .rpc("publish_dance", {
        p_instructor_id: instructor!.id,
        p_venue_id: venueId,
        p_starts_at: soon(6, 17),
        p_ends_at: soon(6, 20),
      })
      .single();
    expect(publishError).toBeNull();

    // 300m of the coordinates that were sent in. A swapped pair would be roughly
    // 2,000km away and this would come back empty.
    const { data: nearby, error } = await anon.rpc("find_dances_near", {
      p_lat: LAT,
      p_lng: LNG,
      p_radius_meters: 300,
    });

    expect(error).toBeNull();
    const found = (nearby ?? []).find((row) => row.venue_id === venueId);
    expect(found).toBeDefined();
    expect(found?.venue_name).toBe(`${FIXTURE_PREFIX}אולם`);
    expect(found?.instructor_display_name).toBe(`${FIXTURE_PREFIX}מרקידה`);

    // And the position it reports back is the one Places gave us, to ~1m.
    expect(found!.venue_lat).toBeCloseTo(LAT, 4);
    expect(found!.venue_lng).toBeCloseTo(LNG, 4);
  });
});
