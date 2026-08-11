import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, runAsPostgres, serviceClient, signInAs, type Client } from "./helpers";
import { cancelNight, findOwnNight, findOwnNights, rescheduleNight } from "@/lib/db/nights";

/**
 * Per-night management (3.3b), against a real Postgres.
 *
 * Written from the assumption the dispatch insists on and this codebase has been
 * bitten by before: **the Server Action is not the only caller**. Anyone holding
 * a session can POST to PostgREST with their own token, so every rule that
 * matters here is asserted against a client that skips the application
 * entirely. The happy path is a small part of this file; the hostile paths are
 * the point.
 *
 * Four rules from migration 0010, each with its own block below:
 *
 *   - a night is never deleted by a client (the generator would resurrect it)
 *   - `series_date` is never written by a client (same reason, other direction)
 *   - a changed night always carries `overridden_at`
 *   - a marked night can never look untouched again
 *
 * `runAsPostgres` stands in for pg_cron, which is what makes the survival test
 * at the end real rather than a claim about a function nobody ran.
 */

const PHONE_OWNER = "+972500000015";
const PHONE_STRANGER = "+972500000016";

const FIXTURE_PREFIX = "manage-test-";

/** Tel Aviv, so a night here is reachable through the anonymous map query. */
const VENUE_LAT = 32.0853;
const VENUE_LNG = 34.7818;

let service: Client;
let anon: Client;
let owner: Client;
let stranger: Client;

let ownerId: string;
let strangerId: string;
let venueId: string;
let instructorId: string;
let strangerInstructorId: string;
let eventId: string;

/** "YYYY-MM-DD", `days` from today. */
function dateFromToday(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface OccurrenceRow {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  cancellation_reason: string | null;
  overridden_at: string | null;
  original_starts_at: string | null;
  series_date: string | null;
}

async function nightsOf(event: string): Promise<OccurrenceRow[]> {
  const { data, error } = await service
    .from("event_occurrences")
    .select(
      "id, starts_at, ends_at, status, cancellation_reason, overridden_at, original_starts_at, series_date",
    )
    .eq("event_id", event)
    .order("starts_at");

  if (error) throw error;
  return data;
}

async function nightById(id: string): Promise<OccurrenceRow> {
  const { data, error } = await service
    .from("event_occurrences")
    .select(
      "id, starts_at, ends_at, status, cancellation_reason, overridden_at, original_starts_at, series_date",
    )
    .eq("id", id)
    .single();

  if (error) throw error;
  return data;
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
 * Same shape and reason as the other publish suites: the cascade
 * auth.users → profiles → instructors stops at `dance_events.instructor_id`,
 * which is `on delete restrict`, so a user who published cannot be deleted and
 * the next run fails at sign-in for a reason unrelated to what it asserts.
 */
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

  const { data } = await service.auth.admin.listUsers();
  const phones = new Set([PHONE_OWNER, PHONE_STRANGER].map((p) => p.replace("+", "")));
  for (const user of data?.users ?? []) {
    if (!user.phone || !phones.has(user.phone)) continue;
    await deletePublishedDances(user.id);
    const { error } = await service.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`could not delete ${user.phone}: ${error.message}`);
  }
}

/**
 * A fresh recurring series, so every test starts from a horizon of generated
 * nights rather than from whatever the previous test left behind. Recurring
 * rather than one-off on purpose: `series_date` is what half this file is about,
 * and a hand-published night does not have one.
 */
async function freshSeries(): Promise<string> {
  const { data, error } = await owner
    .rpc("publish_recurring_dance", {
      p_instructor_id: instructorId,
      p_venue_id: venueId,
      p_freq: "weekly",
      p_start_date: dateFromToday(3),
      p_local_start_time: "20:00",
      p_local_end_time: "23:00",
    })
    .single();

  if (error) throw error;
  return data.event_id;
}

beforeAll(async () => {
  service = serviceClient();
  await cleanUp();

  anon = anonClient();
  owner = await signInAs(PHONE_OWNER);
  stranger = await signInAs(PHONE_STRANGER);

  const { data: ownerUser } = await owner.auth.getUser();
  const { data: strangerUser } = await stranger.auth.getUser();
  if (!ownerUser.user || !strangerUser.user) throw new Error("sign-in produced no user");
  ownerId = ownerUser.user.id;
  strangerId = strangerUser.user.id;

  const profiles = await service.from("profiles").insert([
    { id: ownerId, display_name: "אורית הבודקת", phone: PHONE_OWNER },
    { id: strangerId, display_name: "זר", phone: PHONE_STRANGER },
  ]);
  if (profiles.error) throw profiles.error;

  const { data: instructors, error: instructorError } = await service
    .from("instructors")
    .insert([
      { profile_id: ownerId, display_name: "אורית מרקידה" },
      { profile_id: strangerId, display_name: "זר מרקיד" },
    ])
    .select("id, profile_id");
  if (instructorError) throw instructorError;

  instructorId = instructors.find((row) => row.profile_id === ownerId)!.id;
  strangerInstructorId = instructors.find((row) => row.profile_id === strangerId)!.id;

  const { data: venue, error: venueError } = await service
    .from("venues")
    .insert({
      name: `${FIXTURE_PREFIX}hall`,
      address: "רחוב הבדיקה 4, תל אביב",
      location: `POINT(${VENUE_LNG} ${VENUE_LAT})`,
    })
    .select("id")
    .single();
  if (venueError) throw venueError;
  venueId = venue.id;

  eventId = await freshSeries();
});

afterAll(async () => {
  await cleanUp();
});

describe("a night can never be deleted by a client", () => {
  it("refuses the OWNER's delete at the privilege layer", async () => {
    // The sharpest edge in this feature. Deleting looks like the obvious way to
    // take a night off the board and is the one thing that must not work: the
    // generator skips a slot because a row EXISTS in it (migration 0009), so a
    // deleted night comes back on the next nightly pass at its original time,
    // marked 'scheduled', telling every dancer a cancelled dance is on.
    const [night] = await nightsOf(eventId);

    const { error } = await owner
      .from("event_occurrences")
      .delete()
      .eq("id", night!.id)
      .select();

    // 42501 — the DELETE privilege is gone, so this is refused before RLS is
    // even consulted. A policy alone would be a row filter; this is the whole
    // statement being unavailable.
    expect(error?.code).toBe("42501");
    expect((await nightById(night!.id)).id).toBe(night!.id);
  });

  it("refuses an anonymous delete too", async () => {
    const [night] = await nightsOf(eventId);

    const { error } = await anon
      .from("event_occurrences")
      .delete()
      .eq("id", night!.id)
      .select();

    expect(error?.code).toBe("42501");
  });

  it("still lets an instructor remove a whole dance, which cascades", async () => {
    // The escape hatch, and it is a different action: deleting the series
    // removes the rule too, so there is nothing left to regenerate from. This is
    // how an instructor unpublishes, and it is deliberately not what the
    // per-night controls do.
    const throwaway = await freshSeries();
    expect((await nightsOf(throwaway)).length).toBeGreaterThan(0);

    const { error } = await owner.from("dance_events").delete().eq("id", throwaway);

    expect(error).toBeNull();
    expect(await nightsOf(throwaway)).toHaveLength(0);
  });
});

describe("the generator's key is out of a client's reach", () => {
  it("refuses to let the owner rewrite series_date", async () => {
    // Freeing a slot has the same effect as deleting the row, one step further
    // along: the night stays, and the generator adds a SECOND one beside it.
    const [night] = await nightsOf(eventId);

    const { error } = await owner
      .from("event_occurrences")
      .update({ series_date: dateFromToday(45) })
      .eq("id", night!.id)
      .select();

    expect(error?.code).toBe("42501");
    expect((await nightById(night!.id)).series_date).toBe(night!.series_date);
  });

  it("refuses to let the owner move a night onto another instructor's dance", async () => {
    // Previously blocked by event_occurrences_update_own's WITH CHECK, and now
    // one layer earlier: `event_id` is outside the UPDATE grant, so the
    // privilege check refuses it before a policy is consulted. The policy stays
    // as defence in depth.
    const [night] = await nightsOf(eventId);

    const { error } = await owner
      .from("event_occurrences")
      .update({ event_id: "00000000-0000-0000-0000-000000000000" })
      .eq("id", night!.id)
      .select();

    expect(error?.code).toBe("42501");
  });
});

describe("a stranger with a session can do nothing to somebody else's night", () => {
  it("cannot cancel it", async () => {
    const [night] = await nightsOf(eventId);

    const { data, error } = await stranger
      .from("event_occurrences")
      .update({ status: "cancelled", cancellation_reason: "לא שלי" })
      .eq("id", night!.id)
      .select();

    // A USING-denied UPDATE matches no row, so PostgREST reports success with an
    // empty result. That is exactly why the production path checks the row count
    // instead of trusting the absence of an error — see src/lib/db/nights.ts.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const after = await nightById(night!.id);
    expect(after.status).toBe("scheduled");
    expect(after.cancellation_reason).toBeNull();
  });

  it("cannot move its hour", async () => {
    const [night] = await nightsOf(eventId);
    const moved = new Date(Date.parse(night!.starts_at) + 3_600_000).toISOString();

    const { data, error } = await stranger
      .from("event_occurrences")
      .update({ starts_at: moved })
      .eq("id", night!.id)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect((await nightById(night!.id)).starts_at).toBe(night!.starts_at);
  });

  it("cannot reach it through the production write path either", async () => {
    // Through `cancelNight`, which is what the Server Action calls. The point is
    // that it reports the refusal rather than returning ok on a statement that
    // changed nothing.
    const [night] = await nightsOf(eventId);

    await expect(
      cancelNight(stranger, { occurrenceId: night!.id, reason: "לא שלי" }),
    ).resolves.toEqual({ ok: false, reason: "notYours" });
  });

  it("is not shown it by findOwnNight, even though the table is readable", async () => {
    // `event_occurrences_select_authenticated` is `using (true)` — any signed-in
    // user may READ any night, deliberately. So the ownership filter has to be
    // in the query, and this is the assertion that it is. Removing the
    // `.eq("dance_events.instructor_id", ...)` makes this fail.
    const [night] = await nightsOf(eventId);

    await expect(
      findOwnNight(stranger, strangerInstructorId, night!.id),
    ).resolves.toBeNull();
    await expect(
      findOwnNight(owner, instructorId, night!.id),
    ).resolves.not.toBeNull();
  });

  it("sees none of the owner's nights in their own manage list", async () => {
    const theirs = await findOwnNights(stranger, strangerInstructorId);
    expect(theirs).toEqual([]);

    const mine = await findOwnNights(owner, instructorId);
    expect(mine.length).toBeGreaterThan(0);
  });

  it("cannot cancel anonymously at all", async () => {
    const [night] = await nightsOf(eventId);

    const { error } = await anon
      .from("event_occurrences")
      .update({ status: "cancelled" })
      .eq("id", night!.id)
      .select();

    // `anon` holds SELECT and nothing else, so this is the privilege layer, not
    // a policy.
    expect(error?.code).toBe("42501");
  });
});

describe("every change to a night is marked, by the database", () => {
  it("stamps overridden_at on a cancellation that never mentioned it", async () => {
    const [night] = await nightsOf(eventId);
    expect(night!.overridden_at).toBeNull();

    // Note what is NOT sent: `overridden_at`. The production path does not send
    // it either — the trigger is what makes forgetting it impossible, including
    // for a caller who skips this application.
    const { error } = await owner
      .from("event_occurrences")
      .update({ status: "cancelled", cancellation_reason: "בדיקה" })
      .eq("id", night!.id)
      .select();

    expect(error).toBeNull();
    expect((await nightById(night!.id)).overridden_at).not.toBeNull();
  });

  it("refuses to let an existing mark be cleared", async () => {
    const [night] = await nightsOf(eventId);
    const before = await nightById(night!.id);
    expect(before.overridden_at).not.toBeNull();

    const { error } = await owner
      .from("event_occurrences")
      .update({ overridden_at: null })
      .eq("id", night!.id)
      .select();

    expect(error).toBeNull();
    // "Put it back and nobody will know" is not a capability worth having on the
    // one table AGENTS.md §10 is about.
    expect((await nightById(night!.id)).overridden_at).toBe(before.overridden_at);
  });

  it("holds the constraint even with the trigger out of the way", async () => {
    // The trigger makes the mark automatic; the CHECK makes its absence
    // impossible. Asserted separately, with the trigger disabled, because a test
    // that only ever goes through the trigger would pass just as happily if the
    // constraint had never been written.
    const [night] = await nightsOf(eventId);

    expect(() =>
      runAsPostgres(
        `alter table public.event_occurrences disable trigger event_occurrences_stamp_override;
         update public.event_occurrences set status = 'cancelled', overridden_at = null where id = '${night!.id}';`,
      ),
    ).toThrow();

    runAsPostgres(
      "alter table public.event_occurrences enable trigger event_occurrences_stamp_override;",
    );

    // And the trigger really is back on, so the rest of the file is not running
    // against a table with its enforcement switched off.
    expect(
      runAsPostgres(
        "select tgenabled from pg_trigger where tgname = 'event_occurrences_stamp_override';",
      ),
    ).toBe("O");
  });

  it("refuses a night that claims it was moved to the time it already had", async () => {
    const [night] = await nightsOf(eventId);

    const { error } = await owner
      .from("event_occurrences")
      .update({ original_starts_at: night!.starts_at })
      .eq("id", night!.id)
      .select();

    // 23514 — event_occurrences_original_differs. A night moved back to where it
    // began must stop claiming it moved, or the label lies to a dancer.
    expect(error?.code).toBe("23514");
  });
});

describe("cancelling a night, end to end", () => {
  let cancelledId: string;
  let cancelledSlot: string | null;
  let cancelledRow: OccurrenceRow;

  it("takes the night off through the production path and leaves the row in place", async () => {
    const nights = await nightsOf(eventId);
    const target = nights.find((row) => row.status === "scheduled")!;
    cancelledId = target.id;
    cancelledSlot = target.series_date;

    await expect(
      cancelNight(owner, { occurrenceId: target.id, reason: "תקלה במזגן" }),
    ).resolves.toEqual({ ok: true });

    cancelledRow = await nightById(target.id);
    expect(cancelledRow.status).toBe("cancelled");
    expect(cancelledRow.cancellation_reason).toBe("תקלה במזגן");
    expect(cancelledRow.overridden_at).not.toBeNull();
    // The row is still there, and still in its slot. That is the whole design.
    expect(cancelledRow.series_date).toBe(cancelledSlot);
  });

  it("keeps reaching a visitor with no account, with its status", async () => {
    // THE assertion this product turns on, and the reason a cancelled night is
    // not hidden: a dancer who already planned their evening has to be able to
    // read "בוטל" without an account. Hiding the row would send them to a hall
    // that is dark (AGENTS.md §2.6, §10; migrations 0002 and 0005 say the same).
    const { data, error } = await anon.rpc("find_dances_near", {
      p_lat: VENUE_LAT,
      p_lng: VENUE_LNG,
      p_radius_meters: 5000,
    });

    expect(error).toBeNull();

    const seen = (data ?? []).filter((row) => row.occurrence_id === cancelledId);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.status).toBe("cancelled");
  });

  it("survives a full generator pass, untouched and undoubled", async () => {
    // The loop the whole feature depends on, run the way pg_cron runs it. If the
    // cancel had been a delete, this is where the night would come back.
    runAsPostgres("select public.generate_occurrences();");

    const after = await nightById(cancelledId);
    expect(after).toEqual(cancelledRow);

    const sameSlot = (await nightsOf(eventId)).filter(
      (row) => row.series_date === cancelledSlot,
    );
    expect(sameSlot).toHaveLength(1);
  });
});

describe("moving a night to a different hour, end to end", () => {
  let movedId: string;
  let originalStartsAt: string;

  it("updates the row in place and records where it started", async () => {
    const nights = await nightsOf(eventId);
    const target = nights.find((row) => row.status === "scheduled")!;
    movedId = target.id;
    originalStartsAt = target.starts_at;

    const night = await findOwnNight(owner, instructorId, target.id);
    expect(night).not.toBeNull();

    // An hour later, expressed the way the action does it: wall-clock times read
    // against the night's own date.
    await expect(
      rescheduleNight(owner, {
        occurrenceId: target.id,
        startsAtUtc: new Date(Date.parse(target.starts_at) + 3_600_000).toISOString(),
        endsAtUtc: new Date(Date.parse(target.ends_at) + 3_600_000).toISOString(),
        currentStartsAt: night!.startsAt,
        currentOriginalStartsAt: night!.originalStartsAt,
      }),
    ).resolves.toEqual({ ok: true });

    const after = await nightById(target.id);
    expect(Date.parse(after.starts_at)).toBe(Date.parse(originalStartsAt) + 3_600_000);
    expect(Date.parse(after.original_starts_at!)).toBe(Date.parse(originalStartsAt));
    // Still 'scheduled': docs/decisions/0003 reserves 'moved' for a venue change
    // and forbids it without one.
    expect(after.status).toBe("scheduled");
    expect(after.overridden_at).not.toBeNull();
    // Same row, same slot — never a delete and a re-insert.
    expect(after.id).toBe(target.id);
    expect(after.series_date).toBe(target.series_date);
  });

  it("tells a visitor with no account that the hour changed", async () => {
    const { data, error } = await anon.rpc("find_dances_near", {
      p_lat: VENUE_LAT,
      p_lng: VENUE_LNG,
      p_radius_meters: 5000,
    });

    expect(error).toBeNull();

    const seen = (data ?? []).find((row) => row.occurrence_id === movedId);
    expect(seen).toBeDefined();
    // Without this the one change a dancer cannot see coming would be invisible:
    // the status is still 'scheduled', so the label has nothing else to go on.
    expect(Date.parse(seen!.original_starts_at)).toBe(Date.parse(originalStartsAt));
  });

  it("keeps the FIRST original when the night is moved a second time", async () => {
    const before = await nightById(movedId);
    const night = await findOwnNight(owner, instructorId, movedId);

    await expect(
      rescheduleNight(owner, {
        occurrenceId: movedId,
        startsAtUtc: new Date(Date.parse(before.starts_at) + 3_600_000).toISOString(),
        endsAtUtc: new Date(Date.parse(before.ends_at) + 3_600_000).toISOString(),
        currentStartsAt: night!.startsAt,
        currentOriginalStartsAt: night!.originalStartsAt,
      }),
    ).resolves.toEqual({ ok: true });

    // A dancer planned around the time they were originally told, not around the
    // intermediate one they may never have seen.
    expect(Date.parse((await nightById(movedId)).original_starts_at!)).toBe(
      Date.parse(originalStartsAt),
    );
  });

  it("stops claiming a move once the night is put back where it started", async () => {
    const night = await findOwnNight(owner, instructorId, movedId);

    await expect(
      rescheduleNight(owner, {
        occurrenceId: movedId,
        startsAtUtc: originalStartsAt,
        endsAtUtc: (await nightById(movedId)).ends_at,
        currentStartsAt: night!.startsAt,
        currentOriginalStartsAt: night!.originalStartsAt,
      }),
    ).resolves.toEqual({ ok: true });

    const after = await nightById(movedId);
    expect(after.original_starts_at).toBeNull();
    // The mark stays, though — a person really did touch this night.
    expect(after.overridden_at).not.toBeNull();
  });

  it("survives a generator pass, in its slot, with no second night beside it", async () => {
    const before = await nightById(movedId);
    const slot = before.series_date;

    runAsPostgres("select public.generate_occurrences();");

    expect(await nightById(movedId)).toEqual(before);
    expect((await nightsOf(eventId)).filter((row) => row.series_date === slot)).toHaveLength(
      1,
    );
  });
});
