import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, signInAs, type Client } from "./helpers";
import { findOwnInstructor } from "@/lib/db/publisher";

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

/**
 * Removes everything a test user published, whatever venue it was at.
 *
 * Not optional tidying — without it the user delete below fails silently. The
 * cascade auth.users → profiles → instructors stops dead at
 * `dance_events.instructor_id`, which is `on delete restrict` (migration 0001,
 * deliberately: removing an instructor would orphan their dances). A user that
 * survives keeps the OTP cooldown keyed on it, and the next run of this file
 * fails at sign-in for a reason that has nothing to do with what it asserts.
 *
 * Keyed on the instructor rather than on the fixture venue prefix, because a
 * dance published at a SEEDED venue is invisible to a venue-prefix sweep and is
 * exactly what a stray probe or a half-finished run leaves behind.
 */
async function deletePublishedDances(profileId: string): Promise<void> {
  const { data: instructors } = await service
    .from("instructors")
    .select("id")
    .eq("profile_id", profileId);

  for (const instructor of instructors ?? []) {
    const { data: events } = await service
      .from("dance_events")
      .select("id")
      .eq("instructor_id", instructor.id);

    for (const event of events ?? []) {
      await service.from("event_occurrences").delete().eq("event_id", event.id);
      await service.from("dance_events").delete().eq("id", event.id);
    }
  }
}

async function deleteTestUsers(): Promise<void> {
  const { data } = await service.auth.admin.listUsers();
  const phones = new Set([PHONE_PUBLISHER, PHONE_OTHER].map((p) => p.replace("+", "")));

  for (const user of data?.users ?? []) {
    if (!user.phone || !phones.has(user.phone)) continue;

    await deletePublishedDances(user.id);
    // Only now can this succeed; the rest cascades to profiles and instructors.
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`could not delete ${user.phone}: ${error.message}`);
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

  // Seeded with service_role rather than through the 3.2b add-a-venue path: this
  // suite is about publishing, and a fixture that depended on Google Places would
  // make every test here fail whenever Places did.
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

  it("publishes a dance and its night in one call, under its own instructor row", async () => {
    // Through the RPC the app actually uses (migration 0006), not two raw
    // inserts: the atomicity is the property under test, and hand-rolling the
    // pair here would assert something the product no longer does.
    const { data, error } = await publisher
      .rpc("publish_dance", {
        p_instructor_id: instructorId,
        p_venue_id: venueId,
        p_starts_at: nightFromNow(7, 17),
        p_ends_at: nightFromNow(7, 20),
      })
      .single();

    expect(error).toBeNull();
    eventId = data!.event_id;
    occurrenceId = data!.occurrence_id;

    // Reaching this point at all proves owns_event() saw the event the same
    // transaction had just inserted — the occurrence insert would otherwise have
    // failed its WITH CHECK and taken the event down with it.
    const { data: event } = await service
      .from("dance_events")
      .select("recurrence_rule, price_agorot")
      .eq("id", eventId)
      .single();

    // Non-recurring is the whole of 3.2a; a pattern here would mean 3.3 leaked in.
    expect(event?.recurrence_rule).toBeNull();
    expect(event?.price_agorot).toBe(0);

    const { data: occurrence } = await service
      .from("event_occurrences")
      .select("status")
      .eq("id", occurrenceId)
      .single();
    expect(occurrence?.status).toBe("scheduled");
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

describe("publish_dance is atomic and reachable only by a signed-in caller", () => {
  /**
   * The finding this block exists for. Publishing used to be two PostgREST calls
   * with a compensating delete, and a failure between them left a `dance_events`
   * row with no night. That orphan was NOT invisible, which is what the first
   * version of docs/decisions/0014 got wrong: `anon` holds SELECT on the table and
   * `dance_events_select_public` is `using (true)`, so it came straight back out
   * of /rest/v1/dance_events to a caller with no account.
   */
  async function eventsVisibleToAnon(instructor: string): Promise<number> {
    const { data, error } = await anon
      .from("dance_events")
      .select("id")
      .eq("instructor_id", instructor);

    expect(error).toBeNull();
    return (data ?? []).length;
  }

  it("rolls the dance back when its night is rejected, leaving nothing for anon to read", async () => {
    // ends_at before starts_at trips event_occurrences_ends_after_starts, which
    // is the second insert failing after the first has already succeeded — the
    // exact shape that used to orphan a row.
    const { data: instructor } = await service
      .from("instructors")
      .select("id")
      .eq("profile_id", publisherId)
      .single();
    const instructorId = instructor!.id;

    const before = await eventsVisibleToAnon(instructorId);

    const { error } = await publisher.rpc("publish_dance", {
      p_instructor_id: instructorId,
      p_venue_id: venueId,
      p_starts_at: nightFromNow(21, 20),
      p_ends_at: nightFromNow(21, 17),
    });

    // 23514 — a check constraint, raised by the occurrence insert.
    expect(error?.code).toBe("23514");

    // The assertion that matters, and it is deliberately made through `anon`
    // rather than service_role: the question is not "is the row gone from the
    // table" but "can someone with no account see a dance with no night".
    expect(await eventsVisibleToAnon(instructorId)).toBe(before);
  });

  it("refuses an anonymous caller at the privilege layer", async () => {
    const { data: instructor } = await service
      .from("instructors")
      .select("id")
      .eq("profile_id", publisherId)
      .single();

    const { error } = await anon.rpc("publish_dance", {
      p_instructor_id: instructor!.id,
      p_venue_id: venueId,
      p_starts_at: nightFromNow(22, 17),
      p_ends_at: nightFromNow(22, 20),
    });

    // CREATE FUNCTION grants EXECUTE to PUBLIC by default, so this passing is
    // what proves migration 0006's REVOKE is present and doing something.
    expect(error?.code).toBe("42501");
    expect(error?.message ?? "").toContain("publish_dance");
  });

  it("refuses a signed-in caller publishing under somebody else's instructor", async () => {
    const { data: instructor } = await service
      .from("instructors")
      .select("id")
      .eq("profile_id", publisherId)
      .single();
    const instructorId = instructor!.id;

    const before = await eventsVisibleToAnon(instructorId);

    // SECURITY INVOKER is what makes this fail: the function runs as `other`, so
    // dance_events_insert_own evaluates owns_instructor() for `other` and refuses.
    // A DEFINER function would have sailed through here.
    const { error } = await other.rpc("publish_dance", {
      p_instructor_id: instructorId,
      p_venue_id: venueId,
      p_starts_at: nightFromNow(23, 17),
      p_ends_at: nightFromNow(23, 20),
    });

    expect(error?.code).toBe("42501");
    expect(await eventsVisibleToAnon(instructorId)).toBe(before);
  });
});

describe("instructors is world-readable, so ownership must be filtered in the query", () => {
  it("findOwnInstructor returns null for a caller who has no instructor row", async () => {
    // THE pin, and it calls the production function rather than re-typing its
    // query. The previous version of this block asserted on hand-rolled filtered
    // and unfiltered selects, which described the table's behaviour correctly and
    // pinned nothing: deleting `.eq("profile_id", …)` from findOwnInstructor left
    // it green, because it never called findOwnInstructor.
    //
    // `other` has a session and no instructor row, while `publisher` has one — so
    // an unfiltered read here returns somebody else's, and null is only the right
    // answer if the filter is present. Mutation-checked: with the `.eq` removed
    // from src/lib/db/publisher.ts, this test fails.
    await expect(findOwnInstructor(other, otherId)).resolves.toBeNull();
  });

  it("findOwnInstructor returns the caller's own row when they have one", async () => {
    // The other half, so the test above cannot be satisfied by a function that
    // simply always returns null.
    const instructor = await findOwnInstructor(publisher, publisherId);

    expect(instructor).not.toBeNull();
    expect(instructor?.displayName).toBe("רונית מרקידה");
    expect(instructor?.verified).toBe(false);
  });

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

  it("cannot add a venue without naming a Google place", async () => {
    // 3.2b opened this table to any signed-in user (migration 0007), so the old
    // assertion — "venues stay curated server-side" — is no longer the rule. The
    // remaining bar is place_id, and it is what stops a publisher inventing a
    // hall out of free text. The allowed path lives in tests/rls/venues.test.ts.
    const { error } = await other.from("venues").insert({
      name: `${FIXTURE_PREFIX}not-allowed`,
      address: "רחוב האסור 1",
      location: "POINT(34.78 32.08)",
    });

    expect(error?.code).toBe("42501");
  });
});
