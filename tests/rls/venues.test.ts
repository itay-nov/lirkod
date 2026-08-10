import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, signInAs, type Client } from "./helpers";

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
  it("returns the existing venue instead of inserting a second one", async () => {
    const first = await addVenue(member).single();
    expect(first.error).toBeNull();

    // Same place, different name and position — as a second instructor's Places
    // result might plausibly differ. The place_id is what identifies the hall.
    const second = await addVenue(member, {
      p_name: `${FIXTURE_PREFIX}אותו אולם בשם אחר`,
      p_lat: 31.9,
      p_lng: 34.8,
    }).single();

    expect(second.error).toBeNull();
    expect(second.data?.id).toBe(first.data?.id);
    // The first write wins: `on conflict do nothing` does not overwrite, so a
    // later caller cannot rename or move a hall through this path.
    expect(second.data?.name).toBe(`${FIXTURE_PREFIX}אולם`);

    const { data: rows } = await service
      .from("venues")
      .select("id")
      .eq("place_id", PLACE_ID);
    expect(rows ?? []).toHaveLength(1);
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
