import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, signInAs, type Client } from "./helpers";
import { addFavorite, findOwnFavoriteEventIds } from "@/lib/db/favorites";
import { findFavoriteNights } from "@/lib/db/dances";

/**
 * `public.favorites` (migration 0012, Phase 4.5), against a real Postgres.
 *
 * Written from the same assumption manageNights.test.ts states: the Server
 * Action is not the only caller. Anyone holding a session can POST to
 * PostgREST with their own token, so every rule here is asserted against a
 * client that skips the application entirely — the task's own six required
 * cases, labelled (a)-(f) to match.
 *
 * Self-contained fixture, not tests/rls/fixtures.ts: only one dance is
 * needed here, and building it directly keeps this file independent of
 * another suite's teardown timing (the same choice manageNights.test.ts and
 * publishDance.test.ts already make).
 */

const PHONE_A = "+972500000021";
const PHONE_B = "+972500000022";
/** Admin-created, never signed in — only exists to own the fixture dance. */
const PHONE_INSTRUCTOR = "+972500000098";

const FIXTURE_PREFIX = "favorites-test-";

let service: Client;
let anon: Client;
let clientA: Client;
let clientB: Client;
let userAId: string;
let userBId: string;

let favoriteEventId: string;
let scheduledOccurrenceId: string;
let cancelledOccurrenceId: string;
let otherEventId: string;

/** ISO-8601, `days` from now — the occurrences must stay inside every RPC's horizon. */
function daysFromNow(days: number, hourUtc: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return at.toISOString();
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
      // favorites cascades from dance_events (migration 0012's ON DELETE
      // CASCADE), so deleting the events is enough — this line exists to
      // make that explicit rather than to work around its absence.
      await service.from("event_occurrences").delete().in("event_id", eventIds);
      await service.from("dance_events").delete().in("id", eventIds);
    }
    await service.from("venues").delete().in("id", venueIds);
  }

  const { data } = await service.auth.admin.listUsers();
  const phones = new Set(
    [PHONE_A, PHONE_B, PHONE_INSTRUCTOR].map((phone) => phone.replace("+", "")),
  );
  for (const user of data?.users ?? []) {
    if (user.phone && phones.has(user.phone)) {
      await service.auth.admin.deleteUser(user.id);
    }
  }
}

beforeAll(async () => {
  service = serviceClient();
  await cleanUp();

  anon = anonClient();
  clientA = await signInAs(PHONE_A);
  clientB = await signInAs(PHONE_B);

  const { data: userA } = await clientA.auth.getUser();
  const { data: userB } = await clientB.auth.getUser();
  if (!userA.user || !userB.user) throw new Error("sign-in produced no user");
  userAId = userA.user.id;
  userBId = userB.user.id;

  // A and B deliberately get NO `profiles` row. `favorites.user_id`
  // references `auth.users`, not `public.profiles` (migration 0012's own
  // header explains why) — proving favorites work with no profile row is
  // this fixture's shape, not an oversight.

  const { data: instructorUser, error: instructorUserError } =
    await service.auth.admin.createUser({ phone: PHONE_INSTRUCTOR, phone_confirm: true });
  if (instructorUserError || !instructorUser.user) {
    throw new Error(`could not create instructor user: ${instructorUserError?.message}`);
  }
  const { error: profileError } = await service
    .from("profiles")
    .insert({ id: instructorUser.user.id, display_name: "מרקיד הבדיקה", phone: PHONE_INSTRUCTOR });
  if (profileError) throw profileError;

  const { data: instructor, error: instructorError } = await service
    .from("instructors")
    .insert({ profile_id: instructorUser.user.id, display_name: "מרקיד הבדיקה" })
    .select("id")
    .single();
  if (instructorError) throw instructorError;

  const { data: venue, error: venueError } = await service
    .from("venues")
    .insert({
      name: `${FIXTURE_PREFIX}venue`,
      address: "רחוב הבדיקה 1, תל אביב",
      location: "POINT(34.7818 32.0853)",
    })
    .select("id")
    .single();
  if (venueError) throw venueError;

  const { data: events, error: eventsError } = await service
    .from("dance_events")
    .insert([
      { instructor_id: instructor.id, venue_id: venue.id, price_agorot: 3000 },
      { instructor_id: instructor.id, venue_id: venue.id, price_agorot: 3000 },
    ])
    .select("id");
  if (eventsError) throw eventsError;
  favoriteEventId = events[0]!.id;
  otherEventId = events[1]!.id;

  const { data: occurrences, error: occurrencesError } = await service
    .from("event_occurrences")
    .insert([
      {
        event_id: favoriteEventId,
        starts_at: daysFromNow(3, 17),
        ends_at: daysFromNow(3, 20),
        status: "scheduled",
      },
      {
        event_id: favoriteEventId,
        starts_at: daysFromNow(5, 17),
        ends_at: daysFromNow(5, 20),
        status: "cancelled",
        cancellation_reason: "בדיקה",
        overridden_at: new Date().toISOString(),
      },
    ])
    .select("id, status");
  if (occurrencesError) throw occurrencesError;
  scheduledOccurrenceId = occurrences.find((row) => row.status === "scheduled")!.id;
  cancelledOccurrenceId = occurrences.find((row) => row.status === "cancelled")!.id;
});

afterAll(cleanUp);

describe("the happy path — a signed-in dancer favorites and un-favorites their own", () => {
  it("favorites a dance without naming user_id, and reads it back through favorites_select_own", async () => {
    const { error: insertError } = await clientA
      .from("favorites")
      .insert({ event_id: favoriteEventId })
      .select();
    expect(insertError).toBeNull();

    const { data, error } = await clientA.from("favorites").select("event_id, user_id");
    expect(error).toBeNull();
    expect(data).toEqual([{ event_id: favoriteEventId, user_id: userAId }]);
  });

  it("the DEFAULT filled in auth.uid(), not something a client had to supply", async () => {
    const { data } = await service
      .from("favorites")
      .select("user_id")
      .eq("event_id", favoriteEventId)
      .eq("user_id", userAId)
      .single();
    expect(data?.user_id).toBe(userAId);
  });

  it("un-favorites it again", async () => {
    const { error } = await clientA
      .from("favorites")
      .delete()
      .eq("event_id", favoriteEventId)
      .select();
    expect(error).toBeNull();

    const { data } = await clientA.from("favorites").select("event_id");
    expect(data).toEqual([]);
  });
});

describe("favorites are isolated per user", () => {
  it("B favoriting a different dance never shows up in A's list", async () => {
    await clientA.from("favorites").insert({ event_id: favoriteEventId });
    await clientB.from("favorites").insert({ event_id: otherEventId });

    const aIds = await findOwnFavoriteEventIds(clientA, userAId);
    const bIds = await findOwnFavoriteEventIds(clientB, userBId);

    expect(aIds).toEqual([favoriteEventId]);
    expect(bIds).toEqual([otherEventId]);

    await clientA.from("favorites").delete().eq("event_id", favoriteEventId);
    await clientB.from("favorites").delete().eq("event_id", otherEventId);
  });
});

describe("(a) a user cannot read another user's favorites", () => {
  it("B never sees A's favorite through an unfiltered select", async () => {
    await clientA.from("favorites").insert({ event_id: favoriteEventId });

    const { data, error } = await clientB.from("favorites").select("event_id");
    expect(error).toBeNull();
    expect(data).toEqual([]);

    await clientA.from("favorites").delete().eq("event_id", favoriteEventId);
  });

  it("an explicit filter for A's user_id still returns zero rows to B, not an error", async () => {
    await clientA.from("favorites").insert({ event_id: favoriteEventId });

    const { data, error } = await clientB
      .from("favorites")
      .select("event_id")
      .eq("user_id", userAId);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    await clientA.from("favorites").delete().eq("event_id", favoriteEventId);
  });
});

describe("(b) a client cannot insert a favorite under someone else's id", () => {
  it("refuses B naming A's user_id explicitly — favorites_insert_own's WITH CHECK", async () => {
    const { error } = await clientB
      .from("favorites")
      .insert({ user_id: userAId, event_id: otherEventId })
      .select();

    expect(error).not.toBeNull();

    const { data: after } = await service
      .from("favorites")
      .select("user_id")
      .eq("event_id", otherEventId);
    expect(after).toEqual([]);
  });
});

describe("(c) a user cannot delete another user's favorite", () => {
  it("B's delete matches zero rows — RLS row filter, not a crash — and A's favorite survives", async () => {
    await clientA.from("favorites").insert({ event_id: favoriteEventId });

    const { data, error } = await clientB
      .from("favorites")
      .delete()
      .eq("user_id", userAId)
      .eq("event_id", favoriteEventId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("favorites")
      .select("event_id")
      .eq("user_id", userAId)
      .eq("event_id", favoriteEventId);
    expect(after).toHaveLength(1);

    await clientA.from("favorites").delete().eq("event_id", favoriteEventId);
  });
});

describe("(d) a guest cannot write favorites at all", () => {
  it("refuses an anonymous insert — no grant to anon on this table (migration 0012)", async () => {
    const { error } = await anon.from("favorites").insert({ event_id: favoriteEventId }).select();
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("refuses an anonymous delete the same way", async () => {
    await clientA.from("favorites").insert({ event_id: favoriteEventId });

    const { error } = await anon
      .from("favorites")
      .delete()
      .eq("event_id", favoriteEventId)
      .select();
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");

    const { data: after } = await service
      .from("favorites")
      .select("event_id")
      .eq("user_id", userAId)
      .eq("event_id", favoriteEventId);
    expect(after).toHaveLength(1);

    await clientA.from("favorites").delete().eq("event_id", favoriteEventId);
  });

  it("refuses an anonymous read too — favorites are private, no public aggregate this phase", async () => {
    const { error } = await anon.from("favorites").select("event_id");
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });
});

describe("(e) double-favorite is idempotent — no UX error", () => {
  it("addFavorite called twice leaves exactly one row, through the actual app code path", async () => {
    await addFavorite(clientA, { userId: userAId, eventId: favoriteEventId });
    await expect(
      addFavorite(clientA, { userId: userAId, eventId: favoriteEventId }),
    ).resolves.toBeUndefined();

    const { data } = await service
      .from("favorites")
      .select("event_id")
      .eq("user_id", userAId)
      .eq("event_id", favoriteEventId);
    expect(data).toHaveLength(1);

    await clientA.from("favorites").delete().eq("event_id", favoriteEventId);
  });
});

describe("(f) the favorites list surfaces cancelled nights, never hides them", () => {
  it("findFavoriteNights returns both the scheduled and the cancelled occurrence", async () => {
    await clientA.from("favorites").insert({ event_id: favoriteEventId });

    const favoriteEventIds = await findOwnFavoriteEventIds(clientA, userAId);
    expect(favoriteEventIds).toEqual([favoriteEventId]);

    const nights = await findFavoriteNights(clientA, favoriteEventIds);
    const occurrenceIds = nights.map((night) => night.occurrenceId);

    expect(occurrenceIds).toContain(scheduledOccurrenceId);
    expect(occurrenceIds).toContain(cancelledOccurrenceId);

    const cancelled = nights.find((night) => night.occurrenceId === cancelledOccurrenceId);
    expect(cancelled?.status).toBe("cancelled");

    await clientA.from("favorites").delete().eq("event_id", favoriteEventId);
  });
});
