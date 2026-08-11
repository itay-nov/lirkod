import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, runAsPostgres, serviceClient, signInAs, type Client } from "./helpers";
import { publishRecurringDance } from "@/lib/db/dances";

/**
 * The 3.3a write path and the generator's privilege model, against a real
 * Postgres.
 *
 * Two things live here that tests/db/occurrenceGenerator.test.ts cannot assert:
 * who is allowed to call the generator at all, and whether a series published by
 * a signed-in instructor reaches a dancer with no account. The generator's own
 * behaviour — idempotency, the horizon, the `overridden_at` invariant, DST — is
 * that file's job and is not repeated here.
 *
 * Every client below is a real phone-OTP session. `service` sets up and verifies
 * independently and is never the subject of an assertion; `runAsPostgres` stands
 * in for pg_cron, which is the only caller the system generator has.
 *
 * The two phone numbers are this file's own, for the reason docs/decisions/0013
 * gives: `[auth.sms] max_frequency` is keyed on the number, so sharing one with
 * another suite would make each one's timing depend on the other's.
 */

const PHONE_PUBLISHER = "+972500000012";
const PHONE_OTHER = "+972500000013";

const FIXTURE_PREFIX = "recurring-test-";

/** Tel Aviv, so the series is reachable through the map's default region. */
const VENUE_LAT = 32.0853;
const VENUE_LNG = 34.7818;

let service: Client;
let anon: Client;
let publisher: Client;
let other: Client;

let publisherId: string;
let otherId: string;
let venueId: string;
let instructorId: string;

/** "YYYY-MM-DD", `days` from today, as the RPC's date parameters want it. */
function dateFromToday(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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

/**
 * Same shape and same reason as tests/rls/publishDance.test.ts: the cascade
 * auth.users → profiles → instructors stops at `dance_events.instructor_id`,
 * which is `on delete restrict`, so a user who published cannot be deleted and
 * the next run fails at sign-in for a reason unrelated to what it asserts.
 */
async function deleteTestUsers(): Promise<void> {
  const { data } = await service.auth.admin.listUsers();
  const phones = new Set([PHONE_PUBLISHER, PHONE_OTHER].map((p) => p.replace("+", "")));

  for (const user of data?.users ?? []) {
    if (!user.phone || !phones.has(user.phone)) continue;

    await deletePublishedDances(user.id);
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

  const profiles = await service.from("profiles").insert([
    { id: publisherId, display_name: "דנה הבודקת", phone: PHONE_PUBLISHER },
    { id: otherId, display_name: "זר", phone: PHONE_OTHER },
  ]);
  if (profiles.error) throw profiles.error;

  const { data: instructor, error: instructorError } = await service
    .from("instructors")
    .insert({ profile_id: publisherId, display_name: "דנה מרקידה חוזרת" })
    .select("id")
    .single();
  if (instructorError) throw instructorError;
  instructorId = instructor.id;

  const { data: venue, error: venueError } = await service
    .from("venues")
    .insert({
      name: `${FIXTURE_PREFIX}hall`,
      address: "רחוב הבדיקה 3, תל אביב",
      location: `POINT(${VENUE_LNG} ${VENUE_LAT})`,
    })
    .select("id")
    .single();
  if (venueError) throw venueError;
  venueId = venue.id;
});

afterAll(async () => {
  await cleanUp();
});

describe("the system generator is not reachable by any client", () => {
  it("refuses an anonymous caller at the privilege layer", async () => {
    const { error } = await anon.rpc("generate_occurrences");

    // 42501. CREATE FUNCTION grants EXECUTE to PUBLIC by default, so this passing
    // is what proves migration 0009's REVOKE is present and doing something.
    expect(error?.code).toBe("42501");
    expect(error?.message ?? "").toContain("generate_occurrences");
  });

  it("refuses a signed-in caller too", async () => {
    // The one that matters most. `authenticated` is the role a real person
    // reaches with a phone number, and this function is SECURITY DEFINER — it
    // runs as the table owner and RLS does not apply to it. Reachable from a
    // session, it would be a write across every instructor's dances, available
    // to anybody who can receive an SMS.
    const { error } = await publisher.rpc("generate_occurrences");

    expect(error?.code).toBe("42501");
  });

  it("refuses service_role, which is inside PUBLIC and loses the grant with it", async () => {
    // Deliberate rather than incidental, and the same call migration 0006 makes
    // about publish_dance: service_role bypasses RLS, so a server-side caller
    // holding this would be a second, unaudited way to write occurrences. The
    // only caller is pg_cron, as `postgres`.
    const { error } = await service.rpc("generate_occurrences");

    expect(error?.code).toBe("42501");
  });

  it("still runs as postgres — the role pg_cron uses", async () => {
    // The other half. A function nobody at all can execute would pass all three
    // assertions above and be useless.
    expect(Number(runAsPostgres("select public.generate_occurrences();"))).not.toBeNaN();
  });

  it("is scheduled daily under pg_cron", async () => {
    const job = runAsPostgres(
      "select schedule || ' | ' || command || ' | ' || username from cron.job where jobname = 'lirkod-top-up-occurrences';",
    );

    expect(job).toBe("0 0 * * * | select public.generate_occurrences(); | postgres");
  });
});

describe("the per-event generator is reachable, but only for your own dance", () => {
  it("refuses an anonymous caller at the privilege layer", async () => {
    const { error } = await anon.rpc("generate_occurrences_for_event", {
      p_event_id: "00000000-0000-0000-0000-000000000000",
    });

    expect(error?.code).toBe("42501");
  });

  it("refuses a signed-in stranger topping up somebody else's series", async () => {
    const { data, error: publishError } = await publisher
      .rpc("publish_recurring_dance", {
        p_instructor_id: instructorId,
        p_venue_id: venueId,
        p_freq: "weekly",
        p_start_date: dateFromToday(2),
        p_local_start_time: "20:00",
        p_local_end_time: "23:00",
      })
      .single();
    if (publishError) throw publishError;

    const before = await service
      .from("event_occurrences")
      .select("id")
      .eq("event_id", data.event_id);

    // SECURITY INVOKER is what makes this fail: the insert is checked by
    // event_occurrences_insert_own, which asks owns_event() about `other`. The
    // function does not re-implement that check, which is the point.
    const { error } = await other.rpc("generate_occurrences_for_event", {
      p_event_id: data.event_id,
      p_horizon_days: 365,
    });

    expect(error).not.toBeNull();

    const after = await service
      .from("event_occurrences")
      .select("id")
      .eq("event_id", data.event_id);
    expect(after.data?.length).toBe(before.data?.length);
  });
});

describe("publishing a series", () => {
  let eventId: string;

  it("writes the dance and its first horizon of nights in one call", async () => {
    const result = await publishRecurringDance(publisher, {
      instructorId,
      venueId,
      freq: "weekly",
      startDate: dateFromToday(3),
      localStartTime: "20:00",
      localEndTime: "23:00",
      untilDate: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    eventId = result.eventId;
    // A full 90-day horizon of a weekly series is twelve or thirteen nights, so
    // the number is asserted as "a series, not one night" rather than pinned to a
    // value that depends on which weekday today is.
    expect(result.occurrenceCount).toBeGreaterThan(10);

    const { data: event } = await service
      .from("dance_events")
      .select("recurrence_freq, recurrence_rule, recurrence_start_date, price_agorot")
      .eq("id", eventId)
      .single();

    expect(event?.recurrence_freq).toBe("weekly");
    expect(event?.recurrence_rule).toMatch(/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/);
    expect(event?.price_agorot).toBe(0);

    const { data: occurrences } = await service
      .from("event_occurrences")
      .select("series_date, status")
      .eq("event_id", eventId);

    expect(occurrences).toHaveLength(result.occurrenceCount);
    // Every generated night starts scheduled and carries the slot it came from.
    expect(occurrences?.every((row) => row.status === "scheduled")).toBe(true);
    expect(occurrences?.every((row) => row.series_date !== null)).toBe(true);
  });

  it("reaches an anonymous visitor through find_dances_near", async () => {
    // The point of the whole task: nights nobody typed, produced by a rule, have
    // to arrive at a dancer with no account through the read path that already
    // exists and was not touched (AGENTS.md §2.2).
    const { data, error } = await anon.rpc("find_dances_near", {
      p_lat: VENUE_LAT,
      p_lng: VENUE_LNG,
      p_radius_meters: 5000,
    });

    expect(error).toBeNull();

    const ours = (data ?? []).filter(
      (row) => row.venue_name === `${FIXTURE_PREFIX}hall`,
    );
    expect(ours.length).toBeGreaterThan(1);
    expect(ours[0]!.instructor_display_name).toBe("דנה מרקידה חוזרת");
    expect(ours[0]!.status).toBe("scheduled");
  });

  it("shows an overridden night with its own status, and keeps it after a top-up", async () => {
    // The full loop the product actually depends on: cancel one night, let the
    // generator run again as cron would, and check that the dancer is still told
    // "בוטל" rather than being sent to a dark hall (AGENTS.md §10).
    const { data: nights } = await service
      .from("event_occurrences")
      .select("id, starts_at")
      .eq("event_id", eventId)
      .order("starts_at");

    const target = nights![0]!;
    const { error } = await service
      .from("event_occurrences")
      .update({
        status: "cancelled",
        cancellation_reason: "תקלה באולם",
        overridden_at: new Date().toISOString(),
      })
      .eq("id", target.id);
    if (error) throw error;

    runAsPostgres("select public.generate_occurrences();");

    const { data: seen } = await anon.rpc("find_dances_near", {
      p_lat: VENUE_LAT,
      p_lng: VENUE_LNG,
      p_radius_meters: 5000,
    });

    const cancelled = (seen ?? []).filter((row) => row.occurrence_id === target.id);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.status).toBe("cancelled");

    // And the slot was not filled a second time behind it.
    const sameInstant = (seen ?? []).filter(
      (row) => Date.parse(row.starts_at) === Date.parse(target.starts_at),
    );
    expect(sameInstant).toHaveLength(1);
  });

  it("rolls everything back when the series produces no nights at all", async () => {
    const before = await anon
      .from("dance_events")
      .select("id")
      .eq("instructor_id", instructorId);

    // Every night this describes is already behind us, so there is nothing to
    // materialise — and a dance_events row with no occurrence is the publicly
    // readable orphan docs/decisions/0014 is about.
    const result = await publishRecurringDance(publisher, {
      instructorId,
      venueId,
      freq: "weekly",
      startDate: dateFromToday(-90),
      localStartTime: "20:00",
      localEndTime: "23:00",
      untilDate: dateFromToday(-30),
    });

    expect(result).toEqual({ ok: false, reason: "noNights" });

    const after = await anon
      .from("dance_events")
      .select("id")
      .eq("instructor_id", instructorId);
    expect(after.data?.length).toBe(before.data?.length);
  });

  it("refuses an anonymous caller at the privilege layer", async () => {
    const { error } = await anon.rpc("publish_recurring_dance", {
      p_instructor_id: instructorId,
      p_venue_id: venueId,
      p_freq: "weekly",
      p_start_date: dateFromToday(4),
      p_local_start_time: "20:00",
      p_local_end_time: "23:00",
    });

    expect(error?.code).toBe("42501");
  });

  it("refuses a signed-in caller publishing under somebody else's instructor", async () => {
    const before = await anon
      .from("dance_events")
      .select("id")
      .eq("instructor_id", instructorId);

    const { error } = await other.rpc("publish_recurring_dance", {
      p_instructor_id: instructorId,
      p_venue_id: venueId,
      p_freq: "weekly",
      p_start_date: dateFromToday(5),
      p_local_start_time: "20:00",
      p_local_end_time: "23:00",
    });

    expect(error?.code).toBe("42501");

    const after = await anon
      .from("dance_events")
      .select("id")
      .eq("instructor_id", instructorId);
    expect(after.data?.length).toBe(before.data?.length);
  });
});

describe("the schedule columns cannot be written into a nonsensical state", () => {
  it("refuses a half-specified recurrence", async () => {
    // `authenticated` holds a plain INSERT grant on dance_events, so the RPC is
    // not the only door. A pattern with no start date is a row the generator
    // would have to guess at, and the check constraint refuses it here rather
    // than leaving the guess to be invented later.
    const { error } = await publisher.from("dance_events").insert({
      instructor_id: instructorId,
      venue_id: venueId,
      price_agorot: 0,
      recurrence_freq: "weekly",
    });

    expect(error?.code).toBe("23514");
  });

  it("refuses an end date before the start date", async () => {
    const { error } = await publisher.from("dance_events").insert({
      instructor_id: instructorId,
      venue_id: venueId,
      price_agorot: 0,
      recurrence_freq: "weekly",
      recurrence_start_date: dateFromToday(10),
      recurrence_until_date: dateFromToday(3),
      recurrence_local_start_time: "20:00",
      recurrence_local_end_time: "23:00",
    });

    expect(error?.code).toBe("23514");
  });

  it("refuses a night that would run longer than twelve hours", async () => {
    const { error } = await publisher.from("dance_events").insert({
      instructor_id: instructorId,
      venue_id: venueId,
      price_agorot: 0,
      recurrence_freq: "weekly",
      recurrence_start_date: dateFromToday(10),
      recurrence_local_start_time: "20:00",
      recurrence_local_end_time: "19:00",
    });

    expect(error?.code).toBe("23514");
  });

  it("refuses a hand-written recurrence_rule, because the column is derived", async () => {
    const { error } = await publisher.from("dance_events").insert({
      instructor_id: instructorId,
      venue_id: venueId,
      price_agorot: 0,
      recurrence_rule: "FREQ=WEEKLY;BYDAY=TU",
    });

    // 428C9 — cannot insert a non-DEFAULT value into a generated column. This is
    // what makes "the rule and the schedule cannot disagree" a property of the
    // database rather than a convention writers are asked to follow.
    expect(error?.code).toBe("428C9");
  });
});
