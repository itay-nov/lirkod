import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, signInAs, PHONE_INSTRUCTOR_A, PHONE_DANCER, type Client } from "./helpers";
import { setup, teardown, type Fixtures } from "./fixtures";

/**
 * These run against the local stack (`npm run db:start`), not a mock, because RLS is
 * only real when Postgres evaluates it.
 *
 * A denial surfaces in one of two shapes depending on which layer catches it, and the
 * assertions below are written against the specific layer on purpose — asserting
 * "error OR empty" would pass even if a policy silently stopped working.
 *
 * Privilege layer (checked first, before RLS) -> error 42501.
 *   `anon` holds SELECT on the four public tables and nothing else, so every anonymous
 *   write, and any anonymous read of profiles, is refused before RLS is consulted.
 *
 * RLS layer (only reached once the privilege exists) -> no error.
 *   `authenticated` does hold the write privileges, so one instructor reaching for
 *   another's row is filtered by policy instead: SELECT and USING-denied UPDATE/DELETE
 *   come back empty, and a WITH CHECK violation raises.
 *
 * "No error" is therefore never on its own proof that a write happened, so every
 * negative case re-reads through the service client to confirm nothing moved.
 */

let fixtures: Fixtures;
let service: Client;
let anon: Client;
let instructorA: Client;
let dancer: Client;

beforeAll(async () => {
  service = serviceClient();
  fixtures = await setup();
  anon = anonClient();
  instructorA = await signInAs(PHONE_INSTRUCTOR_A);
  dancer = await signInAs(PHONE_DANCER);
});

afterAll(async () => {
  await teardown();
});

async function venueNameById(id: string): Promise<string | undefined> {
  const { data } = await service.from("venues").select("name").eq("id", id).maybeSingle();
  return data?.name;
}

describe("venues — anonymous read is the product premise (AGENTS.md §2.1)", () => {
  it("lets a visitor with no account read venues", async () => {
    const { data, error } = await anon.from("venues").select("id, name, address, location");

    expect(error).toBeNull();
    expect(data?.length).toBeGreaterThanOrEqual(2);
    expect(data?.map((v) => v.id)).toContain(fixtures.venue1Id);
  });

  it("denies an anonymous insert", async () => {
    const { error } = await anon.from("venues").insert({
      name: "rls-test-injected",
      address: "nowhere",
      location: "POINT(34.78 32.08)",
    });

    expect(error).not.toBeNull();
  });

  it("denies an anonymous update, and the row is untouched", async () => {
    const before = await venueNameById(fixtures.venue1Id);

    const { error } = await anon
      .from("venues")
      .update({ name: "rls-test-overwritten" })
      .eq("id", fixtures.venue1Id)
      .select();

    expect(error?.code).toBe("42501");
    expect(await venueNameById(fixtures.venue1Id)).toBe(before);
  });

  it("denies an anonymous delete, and the row survives", async () => {
    const { error } = await anon
      .from("venues")
      .delete()
      .eq("id", fixtures.venue1Id)
      .select();

    expect(error?.code).toBe("42501");
    expect(await venueNameById(fixtures.venue1Id)).toBeDefined();
  });

  it("denies a venue insert that names no Google place", async () => {
    // This used to read "venues are curated server-side", which stopped being
    // true in 3.2b: a signed-in user may now add a venue (migration 0007,
    // docs/decisions/0015). What is still refused — and what this now asserts —
    // is an insert with no place_id, which is what keeps the table from becoming
    // free text. tests/rls/venues.test.ts covers the write path that IS allowed.
    const { error } = await instructorA.from("venues").insert({
      name: "rls-test-instructor-made",
      address: "nowhere",
      location: "POINT(34.78 32.08)",
    });

    expect(error).not.toBeNull();
  });
});

describe("dance_events — public read, owner-only write", () => {
  it("lets a visitor with no account read every dance, including the price", async () => {
    const { data, error } = await anon
      .from("dance_events")
      .select("id, price_agorot, dance_types, recurrence_rule");

    expect(error).toBeNull();
    expect(data?.map((e) => e.id)).toEqual(
      expect.arrayContaining([fixtures.eventAId, fixtures.eventBId]),
    );
    expect(data?.find((e) => e.id === fixtures.eventAId)?.price_agorot).toBe(4000);
  });

  // Phase 4.6b (migration 0013). docs/decisions/0023 explains why these three
  // columns get exactly the SAME table-wide-grant-plus-ownership-RLS boundary
  // every other dance_events column already has, rather than a column-scoped
  // grant — these tests are what proves that boundary actually holds for the
  // new columns, the same way the price_agorot tests above prove it for an
  // existing one.
  it("lets a visitor with no account read the new level/type/women-only columns", async () => {
    const { data, error } = await anon
      .from("dance_events")
      .select("id, level, dance_formations, women_only")
      .eq("id", fixtures.eventAId)
      .single();

    expect(error).toBeNull();
    // Fixtures never set these, so this also proves the column DEFAULTs
    // (migration 0013) rather than only that the columns are readable.
    expect(data?.level).toBe("all_levels");
    expect(data?.dance_formations).toEqual([]);
    expect(data?.women_only).toBe(false);
  });

  it("lets an instructor set level/type(s)/women-only on their own dance", async () => {
    const { data, error } = await instructorA
      .from("dance_events")
      .update({ level: "advanced", dance_formations: ["circle", "line"], women_only: true })
      .eq("id", fixtures.eventAId)
      .select("level, dance_formations, women_only");

    expect(error).toBeNull();
    expect(data).toEqual([
      { level: "advanced", dance_formations: ["circle", "line"], women_only: true },
    ]);

    await service
      .from("dance_events")
      .update({ level: "all_levels", dance_formations: [], women_only: false })
      .eq("id", fixtures.eventAId);
  });

  it("denies setting another instructor's level/type/women-only, and they stay unchanged", async () => {
    const { data, error } = await instructorA
      .from("dance_events")
      .update({ level: "advanced", dance_formations: ["mixed"], women_only: true })
      .eq("id", fixtures.eventBId)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("dance_events")
      .select("level, dance_formations, women_only")
      .eq("id", fixtures.eventBId)
      .single();
    expect(after).toEqual({ level: "all_levels", dance_formations: [], women_only: false });
  });

  it("denies an anonymous write of the new columns too", async () => {
    const { error } = await anon
      .from("dance_events")
      .update({ level: "advanced" })
      .eq("id", fixtures.eventAId)
      .select();

    expect(error?.code).toBe("42501");
  });

  // The canary docs/decisions/0023 promises: this migration touches only
  // dance_events, so instructors.verified — the project's existing
  // "did a grant statement leak privilege" indicator (migrations 0004, 0011)
  // — must still be exactly as unwritable as it always was. Not a claim that
  // verified is related to dance attributes; a regression check that it
  // wasn't collaterally reopened.
  it("leaves instructors.verified exactly as unwritable as before this migration", async () => {
    const { error } = await instructorA
      .from("instructors")
      .update({ verified: true })
      .eq("id", fixtures.instructorAId)
      .select();

    expect(error).not.toBeNull();

    const { data: after } = await service
      .from("instructors")
      .select("verified")
      .eq("id", fixtures.instructorAId)
      .single();
    expect(after?.verified).toBe(false);
  });

  it("denies an anonymous insert", async () => {
    const { error } = await anon.from("dance_events").insert({
      instructor_id: fixtures.instructorAId,
      venue_id: fixtures.venue1Id,
      price_agorot: 100,
    });

    expect(error).not.toBeNull();
  });

  it("lets an instructor create a dance under their own instructor row", async () => {
    const { data, error } = await instructorA
      .from("dance_events")
      .insert({
        instructor_id: fixtures.instructorAId,
        venue_id: fixtures.venue1Id,
        price_agorot: 4500,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeDefined();

    if (data) await service.from("dance_events").delete().eq("id", data.id);
  });

  it("denies creating a dance attributed to another instructor", async () => {
    const { error } = await instructorA.from("dance_events").insert({
      instructor_id: fixtures.instructorBId,
      venue_id: fixtures.venue1Id,
      price_agorot: 4500,
    });

    expect(error).not.toBeNull();
  });

  it("lets an instructor change the price of their own dance", async () => {
    const { data, error } = await instructorA
      .from("dance_events")
      .update({ price_agorot: 5000 })
      .eq("id", fixtures.eventAId)
      .select("price_agorot");

    expect(error).toBeNull();
    expect(data).toEqual([{ price_agorot: 5000 }]);

    await service.from("dance_events").update({ price_agorot: 4000 }).eq("id", fixtures.eventAId);
  });

  it("denies editing another instructor's dance, and the price is unchanged", async () => {
    const { data, error } = await instructorA
      .from("dance_events")
      .update({ price_agorot: 1 })
      .eq("id", fixtures.eventBId)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("dance_events")
      .select("price_agorot")
      .eq("id", fixtures.eventBId)
      .single();
    expect(after?.price_agorot).toBe(3500);
  });

  it("denies handing your own dance to another instructor", async () => {
    const { error } = await instructorA
      .from("dance_events")
      .update({ instructor_id: fixtures.instructorBId })
      .eq("id", fixtures.eventAId)
      .select();

    expect(error).not.toBeNull();

    const { data: after } = await service
      .from("dance_events")
      .select("instructor_id")
      .eq("id", fixtures.eventAId)
      .single();
    expect(after?.instructor_id).toBe(fixtures.instructorAId);
  });

  it("denies deleting another instructor's dance, and the dance survives", async () => {
    const { data, error } = await instructorA
      .from("dance_events")
      .delete()
      .eq("id", fixtures.eventBId)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("dance_events")
      .select("id")
      .eq("id", fixtures.eventBId)
      .maybeSingle();
    expect(after?.id).toBe(fixtures.eventBId);
  });
});

describe("event_occurrences — the cancellation path (AGENTS.md §10)", () => {
  it("lets a visitor with no account read tonight's occurrences", async () => {
    const { data, error } = await anon
      .from("event_occurrences")
      .select("id, starts_at, status, override_venue_id");

    expect(error).toBeNull();
    expect(data?.map((o) => o.id)).toEqual(
      expect.arrayContaining([fixtures.occurrenceAId, fixtures.occurrenceBId]),
    );
  });

  it("shows a cancelled night to an anonymous visitor rather than hiding it", async () => {
    const { data, error } = await anon
      .from("event_occurrences")
      .select("id, status, cancellation_reason")
      .eq("id", fixtures.cancelledOccurrenceId)
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe("cancelled");
    expect(data?.cancellation_reason).toBe("המרקיד חולה");
  });

  it("denies an anonymous insert", async () => {
    const { error } = await anon.from("event_occurrences").insert({
      event_id: fixtures.eventAId,
      starts_at: "2026-10-01T17:00:00Z",
      ends_at: "2026-10-01T20:00:00Z",
    });

    expect(error).not.toBeNull();
  });

  describe("the anon read is time-bounded (migration 0005, docs/decisions/0010)", () => {
    // Raw SELECT stays open to anon — §2.2 forbids gating reads — but the
    // unbounded `using (true)` let one request take the whole future table,
    // straight past find_dances_near's 60-day horizon. These pin the window.
    //
    // Filtered by id, not read from a full-table select: an assertion on a
    // whole-table result would also pass if the row were merely pushed off the
    // end by PostgREST's row cap, which is a different mechanism.
    it.each([
      ["beyond the 60-day horizon", () => fixtures.beyondHorizonOccurrenceId],
      ["long past", () => fixtures.longPastOccurrenceId],
    ])("hides an occurrence %s from an anonymous visitor", async (_label, id) => {
      const { data, error } = await anon
        .from("event_occurrences")
        .select("id")
        .eq("id", id());

      // Filtered out by policy, not refused: anon holds the SELECT privilege, so
      // this is the RLS layer and it comes back empty rather than 42501.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      // The row is really there — this is the policy hiding it, not a broken fixture.
      const { data: actual } = await service
        .from("event_occurrences")
        .select("id")
        .eq("id", id())
        .maybeSingle();
      expect(actual?.id).toBe(id());
    });

    it("still shows an anonymous visitor a night inside the window", async () => {
      const { data, error } = await anon
        .from("event_occurrences")
        .select("id")
        .eq("id", fixtures.occurrenceAId);

      expect(error).toBeNull();
      expect(data).toEqual([{ id: fixtures.occurrenceAId }]);
    });

    it.each([
      ["beyond the horizon", () => fixtures.beyondHorizonOccurrenceId],
      ["long past", () => fixtures.longPastOccurrenceId],
    ])("still shows a signed-in user an occurrence %s", async (_label, id) => {
      // authenticated keeps the unbounded read: an instructor needs their own
      // history, and reaching this role costs a phone-OTP sign-in.
      const { data, error } = await dancer
        .from("event_occurrences")
        .select("id")
        .eq("id", id());

      expect(error).toBeNull();
      expect(data).toEqual([{ id: id() }]);
    });
  });

  it("denies an anonymous cancellation, and the night stays scheduled", async () => {
    const { error } = await anon
      .from("event_occurrences")
      .update({ status: "cancelled", cancellation_reason: "בוטל" })
      .eq("id", fixtures.occurrenceAId)
      .select();

    expect(error?.code).toBe("42501");

    const { data: after } = await service
      .from("event_occurrences")
      .select("status")
      .eq("id", fixtures.occurrenceAId)
      .single();
    expect(after?.status).toBe("scheduled");
  });

  it("denies an anonymous delete, and the night survives", async () => {
    const { error } = await anon
      .from("event_occurrences")
      .delete()
      .eq("id", fixtures.occurrenceAId)
      .select();

    expect(error?.code).toBe("42501");

    const { data: after } = await service
      .from("event_occurrences")
      .select("id")
      .eq("id", fixtures.occurrenceAId)
      .maybeSingle();
    expect(after?.id).toBe(fixtures.occurrenceAId);
  });

  it("lets an instructor cancel a night of their own dance", async () => {
    const { data, error } = await instructorA
      .from("event_occurrences")
      .update({
        status: "cancelled",
        cancellation_reason: "אין חשמל באולם",
        overridden_at: new Date().toISOString(),
      })
      .eq("id", fixtures.occurrenceAId)
      .select("status");

    expect(error).toBeNull();
    expect(data).toEqual([{ status: "cancelled" }]);

    await service
      .from("event_occurrences")
      .update({ status: "scheduled", cancellation_reason: null, overridden_at: null })
      .eq("id", fixtures.occurrenceAId);
  });

  it("lets an instructor move a night of their own dance to another venue", async () => {
    const { data, error } = await instructorA
      .from("event_occurrences")
      .update({
        status: "moved",
        override_venue_id: fixtures.venue2Id,
        overridden_at: new Date().toISOString(),
      })
      .eq("id", fixtures.occurrenceAId)
      .select("status, override_venue_id");

    expect(error).toBeNull();
    expect(data).toEqual([{ status: "moved", override_venue_id: fixtures.venue2Id }]);

    await service
      .from("event_occurrences")
      .update({ status: "scheduled", override_venue_id: null, overridden_at: null })
      .eq("id", fixtures.occurrenceAId);
  });

  it("denies cancelling another instructor's night, and it stays scheduled", async () => {
    const { data, error } = await instructorA
      .from("event_occurrences")
      .update({ status: "cancelled", cancellation_reason: "לא שלי" })
      .eq("id", fixtures.occurrenceBId)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("event_occurrences")
      .select("status, cancellation_reason")
      .eq("id", fixtures.occurrenceBId)
      .single();
    expect(after?.status).toBe("scheduled");
    expect(after?.cancellation_reason).toBeNull();
  });

  it("denies moving your own night onto another instructor's dance", async () => {
    const { error } = await instructorA
      .from("event_occurrences")
      .update({ event_id: fixtures.eventBId })
      .eq("id", fixtures.occurrenceAId)
      .select();

    expect(error).not.toBeNull();

    const { data: after } = await service
      .from("event_occurrences")
      .select("event_id")
      .eq("id", fixtures.occurrenceAId)
      .single();
    expect(after?.event_id).toBe(fixtures.eventAId);
  });

  it("denies a signed-in dancer who is not an instructor from cancelling anything", async () => {
    const { data, error } = await dancer
      .from("event_occurrences")
      .update({ status: "cancelled" })
      .eq("id", fixtures.occurrenceAId)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("event_occurrences")
      .select("status")
      .eq("id", fixtures.occurrenceAId)
      .single();
    expect(after?.status).toBe("scheduled");
  });
});

describe("profiles — owner-only, never public", () => {
  it("refuses an anonymous reader outright — not even an empty result set", async () => {
    // anon holds no SELECT privilege on profiles at all, so this is refused a layer
    // earlier than RLS. Phone numbers and home locations are never reachable without
    // a session, whatever a future policy might say.
    const { data, error } = await anon.from("profiles").select("id, display_name, phone");

    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("denies an anonymous insert", async () => {
    const { error } = await anon
      .from("profiles")
      .insert({ id: fixtures.dancerProfileId, display_name: "x", phone: "+972500000009" });

    expect(error).not.toBeNull();
  });

  it("lets a signed-in user read their own row", async () => {
    const { data, error } = await instructorA.from("profiles").select("id, display_name");

    expect(error).toBeNull();
    expect(data).toEqual([{ id: fixtures.profileAId, display_name: "מרקיד א" }]);
  });

  it("hides another user's row from a signed-in user", async () => {
    const { data, error } = await instructorA
      .from("profiles")
      .select("id, phone")
      .eq("id", fixtures.profileBId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("lets a user rename themselves", async () => {
    const { data, error } = await dancer
      .from("profiles")
      .update({ display_name: "רוקדת חדשה" })
      .eq("id", fixtures.dancerProfileId)
      .select("display_name");

    expect(error).toBeNull();
    expect(data).toEqual([{ display_name: "רוקדת חדשה" }]);

    await service
      .from("profiles")
      .update({ display_name: "רוקדת" })
      .eq("id", fixtures.dancerProfileId);
  });

  it("denies editing another user's profile, and their name is unchanged", async () => {
    const { data, error } = await dancer
      .from("profiles")
      .update({ display_name: "נחטף" })
      .eq("id", fixtures.profileAId)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("profiles")
      .select("display_name")
      .eq("id", fixtures.profileAId)
      .single();
    expect(after?.display_name).toBe("מרקיד א");
  });
});

describe("instructors — public identity, owner-only edit, verified is not self-served", () => {
  it("lets a visitor with no account read instructor rows", async () => {
    const { data, error } = await anon.from("instructors").select("id, display_name, bio, verified");

    expect(error).toBeNull();
    expect(data?.map((i) => i.id)).toEqual(
      expect.arrayContaining([fixtures.instructorAId, fixtures.instructorBId]),
    );
  });

  it("shows an anonymous visitor who runs a dance — the map's whole point", async () => {
    const { data, error } = await anon
      .from("instructors")
      .select("display_name")
      .eq("id", fixtures.instructorAId)
      .single();

    expect(error).toBeNull();
    expect(data?.display_name).toBe("דנה מרקידה");
  });

  it("exposes the public name without exposing the private one", async () => {
    // The same person has a different display_name on each table, so if the private
    // row ever leaked into a public read this assertion would catch it.
    const { data: publicName } = await anon
      .from("instructors")
      .select("display_name")
      .eq("id", fixtures.instructorAId)
      .single();
    const { data: privateRows, error: privateError } = await anon
      .from("profiles")
      .select("display_name")
      .eq("id", fixtures.profileAId);

    expect(publicName?.display_name).toBe("דנה מרקידה");
    expect(privateError?.code).toBe("42501");
    expect(privateRows).toBeNull();
  });

  it("lets an instructor rename their public identity", async () => {
    const { data, error } = await instructorA
      .from("instructors")
      .update({ display_name: "דנה כהן" })
      .eq("id", fixtures.instructorAId)
      .select("display_name");

    expect(error).toBeNull();
    expect(data).toEqual([{ display_name: "דנה כהן" }]);

    await service
      .from("instructors")
      .update({ display_name: "דנה מרקידה" })
      .eq("id", fixtures.instructorAId);
  });

  it("denies renaming another instructor's public identity", async () => {
    const { data, error } = await instructorA
      .from("instructors")
      .update({ display_name: "נחטף" })
      .eq("id", fixtures.instructorBId)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("instructors")
      .select("display_name")
      .eq("id", fixtures.instructorBId)
      .single();
    expect(after?.display_name).toBe("יוסי מרקיד");
  });

  it("denies an anonymous insert", async () => {
    const { error } = await anon
      .from("instructors")
      .insert({
        profile_id: fixtures.dancerProfileId,
        display_name: "self-appointed",
        bio: "self-appointed",
      });

    expect(error).not.toBeNull();
  });

  it("denies claiming an instructor row for someone else's profile", async () => {
    const { error } = await dancer
      .from("instructors")
      .insert({ profile_id: fixtures.profileAId, display_name: "לא שלי", bio: "not mine" });

    expect(error).not.toBeNull();
  });

  it("denies self-verifying on the way IN, not just on a later update (migration 0004)", async () => {
    // The sibling test below proves this same insert succeeds without `verified`,
    // so a failure here is the column being refused and nothing else.
    //
    // Rejected, not silently coerced to false: see the migration header. The
    // assertion is on 42501 specifically because that is the privilege layer —
    // `verified` is outside the column-level INSERT grant, so this never reaches
    // RLS. Asserting "some error" would still pass if the grant were widened back
    // and only the policy's WITH CHECK were left holding it.
    const { error } = await dancer
      .from("instructors")
      .insert({
        profile_id: fixtures.dancerProfileId,
        display_name: "מרקיד מאושר בעצמו",
        bio: "self-verified",
        verified: true,
      })
      .select();

    expect(error?.code).toBe("42501");

    const { data: rows } = await service
      .from("instructors")
      .select("id")
      .eq("profile_id", fixtures.dancerProfileId);
    expect(rows).toEqual([]);
  });

  it("still lets that user create their own instructor row — it just arrives unverified", async () => {
    const { data, error } = await dancer
      .from("instructors")
      .insert({
        profile_id: fixtures.dancerProfileId,
        display_name: "מרקידה חדשה",
        bio: "רק התחלתי",
      })
      .select("id, verified")
      .single();

    expect(error).toBeNull();
    expect(data?.verified).toBe(false);

    if (data) await service.from("instructors").delete().eq("id", data.id);
  });

  it("lets an instructor edit their own bio", async () => {
    const { data, error } = await instructorA
      .from("instructors")
      .update({ bio: "מרקיד ותיק" })
      .eq("id", fixtures.instructorAId)
      .select("bio");

    expect(error).toBeNull();
    expect(data).toEqual([{ bio: "מרקיד ותיק" }]);

    await service.from("instructors").update({ bio: "bio a" }).eq("id", fixtures.instructorAId);
  });

  it("denies editing another instructor's bio, and it is unchanged", async () => {
    const { data, error } = await instructorA
      .from("instructors")
      .update({ bio: "נחטף" })
      .eq("id", fixtures.instructorBId)
      .select();

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: after } = await service
      .from("instructors")
      .select("bio")
      .eq("id", fixtures.instructorBId)
      .single();
    expect(after?.bio).toBe("bio b");
  });

  it("denies an instructor verifying themselves, and verified stays false", async () => {
    const { error } = await instructorA
      .from("instructors")
      .update({ verified: true })
      .eq("id", fixtures.instructorAId)
      .select();

    expect(error).not.toBeNull();

    const { data: after } = await service
      .from("instructors")
      .select("verified")
      .eq("id", fixtures.instructorAId)
      .single();
    expect(after?.verified).toBe(false);
  });
});

describe("occurrence status/override constraint (docs/decisions/0003)", () => {
  it("rejects a silent venue change — scheduled with an override venue", async () => {
    const { error } = await service.from("event_occurrences").insert({
      event_id: fixtures.eventAId,
      starts_at: "2026-11-01T17:00:00Z",
      ends_at: "2026-11-01T20:00:00Z",
      status: "scheduled",
      override_venue_id: fixtures.venue2Id,
    });

    expect(error?.message).toContain("event_occurrences_status_matches_override");
  });

  it("rejects 'moved' with no new venue", async () => {
    // `overridden_at` is supplied so that the constraint under test is the one
    // that fires. Since migration 0010 a night that is not 'scheduled' must also
    // carry the mark (event_occurrences_change_is_marked), and without it this
    // row would be rejected for the wrong reason — which would leave the
    // docs/decisions/0003 rule this test exists for unasserted.
    const { error } = await service.from("event_occurrences").insert({
      event_id: fixtures.eventAId,
      starts_at: "2026-11-02T17:00:00Z",
      ends_at: "2026-11-02T20:00:00Z",
      status: "moved",
      overridden_at: new Date().toISOString(),
    });

    expect(error?.message).toContain("event_occurrences_status_matches_override");
  });

  it("allows a night that moved and was then cancelled to keep its override venue", async () => {
    // Both of those states are a person's doing, so the row carries the mark
    // migration 0010 requires. The trigger only stamps on UPDATE — an INSERT of
    // a night that is already cancelled is not a product path, so the caller
    // states it rather than having it filled in behind them.
    const { data, error } = await service
      .from("event_occurrences")
      .insert({
        event_id: fixtures.eventAId,
        starts_at: "2026-11-03T17:00:00Z",
        ends_at: "2026-11-03T20:00:00Z",
        status: "cancelled",
        override_venue_id: fixtures.venue2Id,
        cancellation_reason: "האולם החלופי נסגר",
        overridden_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    expect(error).toBeNull();

    if (data) await service.from("event_occurrences").delete().eq("id", data.id);
  });

  it("rejects an occurrence that ends before it starts", async () => {
    const { error } = await service.from("event_occurrences").insert({
      event_id: fixtures.eventAId,
      starts_at: "2026-11-04T20:00:00Z",
      ends_at: "2026-11-04T17:00:00Z",
    });

    expect(error?.message).toContain("event_occurrences_ends_after_starts");
  });
});
