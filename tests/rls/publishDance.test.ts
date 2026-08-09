import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, signInAs, type Client } from "./helpers";

/**
 * The 3.2a write path, end to end, against a real Postgres.
 *
 * `rls.test.ts` already covers each policy in isolation — owner-only dance
 * writes, the self-verification block, profile isolation. This file asserts the
 * thing none of those can on their own: that a person who has just signed in with
 * a phone number and nothing else can walk the whole path (profile → instructor →
 * dance → night) using only their own session, that every side road off it is
 * closed, and that the result reaches an anonymous visitor. It is deliberately
 * additive; nothing here re-tests a policy that file already pins.
 *
 * Every client below is a real phone-OTP session. `service` exists only to set up
 * and to verify independently, never as the subject of an assertion.
 *
 * The two phone numbers are this file's own. `[auth.sms] max_frequency` is keyed
 * on the number (docs/decisions/0013), so sharing them with another suite would
 * make each one's timing depend on the other's.
 */

const PHONE_PUBLISHER = "+972500000007";
const PHONE_OTHER = "+972500000008";

/** Named so teardown can find exactly what this file made. */
const FIXTURE_PREFIX = "publish-test-";

let service: Client;
let anon: Client;
let publisher: Client;
let other: Client;

let publisherId: string;
let otherId: string;
let venueId: string;

/** Far enough out to be unambiguous, inside the 60-day anon horizon (migration 0005). */
function nightFromNow(days: number, hourUtc: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return at.toISOString();
}

async function deleteTestUsers(): Promise<void> {
  const { data } = await service.auth.admin.listUsers();
  const phones = new Set([PHONE_PUBLISHER, PHONE_OTHER].map((p) => p.replace("+", "")));

  for (const user of data?.users ?? []) {
    // Deleting the auth user cascades to profiles and then to instructors.
    if (user.phone && phones.has(user.phone)) {
      await service.auth.admin.deleteUser(user.id);
    }
  }
}

async function cleanUp(): Promise<void> {
  const { data: venues } = await service
    .from("venues")
    .select("id")
    .like("name", `${FIXTURE_PREFIX}%`);

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

  await deleteTestUsers();
}

beforeAll(async () => {
  service = serviceClient();
  await cleanUp();

  anon = anonClient();
  publisher = await signInAs(PHONE_PUBLISHER);
  other = await signInAs(PHONE_OTHER);

  const { data: publisherUser } = await publisher.auth.getUser();
  const { data: otherUser } = await other.auth.getUser();
  if (!publisherUser.user || !otherUser.user) throw new Error("sign-in produced no user");
  publisherId = publisherUser.user.id;
  otherId = otherUser.user.id;

  // Venues are curated server-side — `authenticated` has SELECT only — so this
  // one is seeded with service_role, which is exactly the arrangement 3.2b will
  // change and this suite documents.
  const { data: venue, error } = await service
    .from("venues")
    .insert({
      name: `${FIXTURE_PREFIX}hall`,
      address: "רחוב הבדיקה 1, תל אביב",
      location: "POINT(34.7818 32.0853)",
    })
    .select("id")
    .single();
  if (error) throw error;
  venueId = venue.id;
});

afterAll(async () => {
  await cleanUp();
});

describe("a signed-in phone number walks the whole publish path", () => {
  let instructorId: string;
  let eventId: string;
  let occurrenceId: string;

  it("creates its own profile and only its own", async () => {
    const { data, error } = await publisher
      .from("profiles")
      .insert({
        id: publisherId,
        display_name: "רונית הבודקת",
        phone: PHONE_PUBLISHER,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBe(publisherId);
  });

  it("refuses to create a profile row for somebody else's user id", async () => {
    // The WITH CHECK on profiles_insert_own. A forged id is the whole attack
    // this policy exists for, and the id arriving from a client is exactly why
    // the server action re-derives it from the session instead.
    const { error } = await publisher.from("profiles").insert({
      id: otherId,
      display_name: "מתחזה",
      phone: "+972500000099",
    });

    expect(error).not.toBeNull();

    const { data } = await service.from("profiles").select("id").eq("id", otherId);
    expect(data ?? []).toHaveLength(0);
  });

  it("registers itself as an instructor, arriving unverified", async () => {
    const { data, error } = await publisher
      .from("instructors")
      .insert({ profile_id: publisherId, display_name: "רונית מרקידה" })
      .select("id, verified")
      .single();

    expect(error).toBeNull();
    // The v1 product decision is that this row can publish immediately. What it
    // must never do is arrive trusted (migration 0004, docs/decisions/0004).
    expect(data?.verified).toBe(false);
    instructorId = data!.id;
  });

  it("cannot self-verify on the way in, even while creating its own row", async () => {
    const { error } = await other.from("instructors").insert({
      profile_id: otherId,
      display_name: "מתחזה מאומת",
      verified: true,
    });

    // 42501: `verified` is outside authenticated's INSERT grant, so this is
    // refused at the privilege layer before a policy is consulted.
    expect(error?.code).toBe("42501");
  });

  it("publishes a dance under its own instructor row", async () => {
    const { data, error } = await publisher
      .from("dance_events")
      .insert({
        instructor_id: instructorId,
        venue_id: venueId,
        recurrence_rule: null,
        price_agorot: 0,
      })
      .select("id, recurrence_rule")
      .single();

    expect(error).toBeNull();
    // Non-recurring is the whole of 3.2a; a pattern here would mean 3.3 leaked in.
    expect(data?.recurrence_rule).toBeNull();
    eventId = data!.id;
  });

  it("adds the one night that makes the dance findable", async () => {
    const { data, error } = await publisher
      .from("event_occurrences")
      .insert({
        event_id: eventId,
        starts_at: nightFromNow(7, 17),
        ends_at: nightFromNow(7, 20),
        status: "scheduled",
        override_venue_id: null,
      })
      .select("id, status")
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe("scheduled");
    occurrenceId = data!.id;
  });

  it("surfaces to an anonymous visitor through find_dances_near", async () => {
    // The point of the whole task: a dance published by a signed-in instructor
    // has to reach someone with no account, through the read path that already
    // exists and was not touched (AGENTS.md §2.2).
    const { data, error } = await anon.rpc("find_dances_near", {
      p_lat: 32.0853,
      p_lng: 34.7818,
      p_radius_meters: 5000,
    });

    expect(error).toBeNull();
    const published = (data ?? []).find((row) => row.occurrence_id === occurrenceId);
    expect(published).toBeDefined();
    expect(published?.venue_name).toBe(`${FIXTURE_PREFIX}hall`);
    expect(published?.instructor_display_name).toBe("רונית מרקידה");
    expect(published?.status).toBe("scheduled");
  });

  it("surfaces to an anonymous visitor through the raw occurrence read too", async () => {
    // The schedule screen reads occurrences directly rather than through the RPC,
    // so both doors are checked.
    const { data, error } = await anon
      .from("event_occurrences")
      .select("id")
      .eq("id", occurrenceId);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });

  describe("and nobody else can touch what it published", () => {
    it("denies another instructor attributing a dance to it", async () => {
      const { error } = await other.from("dance_events").insert({
        instructor_id: instructorId,
        venue_id: venueId,
        price_agorot: 0,
      });

      expect(error).not.toBeNull();
    });

    it("denies another signed-in user adding a night to its dance", async () => {
      // owns_event(event_id) in event_occurrences_insert_own. Without this, a
      // stranger could bolt an extra night onto somebody else's dance.
      const { error } = await other.from("event_occurrences").insert({
        event_id: eventId,
        starts_at: nightFromNow(9, 17),
        ends_at: nightFromNow(9, 20),
        status: "scheduled",
      });

      expect(error).not.toBeNull();

      const { data } = await service
        .from("event_occurrences")
        .select("id")
        .eq("event_id", eventId);
      expect(data ?? []).toHaveLength(1);
    });

    it("denies another signed-in user cancelling its night", async () => {
      const { error } = await other
        .from("event_occurrences")
        .update({ status: "cancelled", cancellation_reason: "לא באמת" })
        .eq("id", occurrenceId);

      // USING-denied UPDATE matches no row, so PostgREST reports no error — which
      // is why the state is re-read rather than trusted.
      expect(error).toBeNull();

      const { data } = await service
        .from("event_occurrences")
        .select("status")
        .eq("id", occurrenceId)
        .single();
      expect(data?.status).toBe("scheduled");
    });

    it("denies an anonymous visitor publishing anything at all", async () => {
      const event = await anon.from("dance_events").insert({
        instructor_id: instructorId,
        venue_id: venueId,
        price_agorot: 0,
      });
      const occurrence = await anon.from("event_occurrences").insert({
        event_id: eventId,
        starts_at: nightFromNow(11, 17),
        ends_at: nightFromNow(11, 20),
        status: "scheduled",
      });

      // `anon` holds SELECT and nothing else, so both are refused at the
      // privilege layer — before RLS is even consulted.
      expect(event.error?.code).toBe("42501");
      expect(occurrence.error?.code).toBe("42501");
    });
  });
});

describe("instructors is world-readable, so ownership must be filtered in the query", () => {
  it("returns somebody else's row to an unfiltered read", async () => {
    // Pins the behaviour that made `findOwnInstructor` wrong before the `eq` was
    // added: `instructors_select_public` is `using (true)`, so RLS narrows this
    // to nothing. If this test ever starts returning zero rows, the policy has
    // changed and the map can no longer name who runs a dance (§2.1) — that is a
    // bigger problem than this test, which is why it is asserted here.
    const { data, error } = await other
      .from("instructors")
      .select("id, profile_id")
      .neq("profile_id", otherId);

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("returns nothing once the caller's own id is the filter", async () => {
    const { data, error } = await other
      .from("instructors")
      .select("id")
      .eq("profile_id", otherId);

    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

describe("a signed-in user who is not an instructor", () => {
  it("cannot publish a dance at all", async () => {
    // `other` has a session but never created an instructor row, so
    // owns_instructor() is false for every id it could name. This is the state
    // the create-dance form is in before its first publish, and it is why the
    // action registers the instructor row rather than assuming one.
    const { data: anyInstructor } = await service
      .from("instructors")
      .select("id")
      .eq("profile_id", otherId);
    expect(anyInstructor ?? []).toHaveLength(0);

    const { error } = await other.from("dance_events").insert({
      instructor_id: "00000000-0000-0000-0000-000000000000",
      venue_id: venueId,
      price_agorot: 0,
    });

    expect(error).not.toBeNull();
  });

  it("still cannot add a venue — those stay curated server-side until 3.2b", async () => {
    const { error } = await other.from("venues").insert({
      name: `${FIXTURE_PREFIX}not-allowed`,
      address: "רחוב האסור 1",
      location: "POINT(34.78 32.08)",
    });

    expect(error?.code).toBe("42501");
  });
});
