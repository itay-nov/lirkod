import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  point,
  runAsPostgres,
  serviceClient,
  signInAs,
  type Client,
} from "./helpers";
import { findActivePromotedEventIds } from "@/lib/db/promotions";

/**
 * `public.get_active_promoted_event_ids` (migration 0017,
 * docs/decisions/0026) — the one read out of the payments schema that an
 * anonymous visitor may make.
 *
 * This file is the security half of the sponsored-promotion boost; the sort
 * half is pure and lives in tests/unit/promotedBoost.test.ts.
 *
 * Two questions, and they are the ones docs/decisions/0025 makes worth asking
 * every time a SECURITY DEFINER function is added over these tables:
 *
 *   1. Can it leak anything commercial? Asserted by pinning the shape of what
 *      comes back — one column, named — and by re-asserting that the table
 *      behind it is still unreadable to the same caller.
 *   2. Can it be used to get a boost without paying? Asserted by walking an
 *      order through every status and window a promotion can be in.
 *
 * Every assertion goes through PostgREST with a real anon or session token, not
 * through the application, for the reason every RLS file here states: a client
 * can always skip the app.
 */

/** Signed in, to prove the `authenticated` half of the grant. */
const PHONE_DANCER = "+972500000028";
/** Admin-created, never signed in — only exists to own the fixture dance. */
const PHONE_INSTRUCTOR = "+972500000097";

const FIXTURE_PREFIX = "promoted-test-";

let service: Client;
let anon: Client;
let dancer: Client;

let instructorId: string;
let instructorUserId: string;

/** Paid, live, inside its window. The only one that should ever come back. */
let promotedEventId: string;
/** Every other event below is a way for a promotion NOT to count. */
let pendingEventId: string;
let failedEventId: string;
let cancelledEventId: string;
let notStartedEventId: string;
let endedEventId: string;
/** Paid and live, but in a different area string. */
let otherAreaEventId: string;

const AREA = "מצפה רמון";
const OTHER_AREA = "ירוחם";

function daysFromNow(days: number, hourUtc: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return at.toISOString();
}

function unwrapId(
  result: { data: { id: string } | null; error: { message: string } | null },
  what: string,
): string {
  if (result.error) throw new Error(`fixture setup failed (${what}): ${result.error.message}`);
  if (result.data === null) throw new Error(`fixture setup returned no row for ${what}`);
  return result.data.id;
}

async function cleanUp(): Promise<void> {
  const fail = (what: string, error: { message: string } | null): void => {
    if (error) throw new Error(`promoted teardown failed (${what}): ${error.message}`);
  };

  const { data: users } = await service.auth.admin.listUsers();
  const phones = new Set([PHONE_DANCER, PHONE_INSTRUCTOR].map((phone) => phone.replace("+", "")));
  const fixtureUsers = (users?.users ?? []).filter((user) => user.phone && phones.has(user.phone));
  const userIds = fixtureUsers.map((user) => user.id);

  const { data: venues } = await service
    .from("venues")
    .select("id")
    .like("name", `${FIXTURE_PREFIX}%`);
  const venueIds = (venues ?? []).map((venue) => venue.id);

  let eventIds: string[] = [];
  if (venueIds.length > 0) {
    const { data: events } = await service
      .from("dance_events")
      .select("id")
      .in("venue_id", venueIds);
    eventIds = (events ?? []).map((event) => event.id);
  }

  // Dependency order, because nothing in the payments schema cascades
  // (migration 0016 uses ON DELETE RESTRICT throughout): promotions hold their
  // orders, orders hold their buyer, and both hold the dance.
  if (eventIds.length > 0) {
    fail(
      "sponsored_promotions",
      (await service.from("sponsored_promotions").delete().in("event_id", eventIds)).error,
    );
  }
  if (userIds.length > 0) {
    fail("orders", (await service.from("orders").delete().in("buyer_id", userIds)).error);
  }
  if (eventIds.length > 0) {
    fail("dance_events", (await service.from("dance_events").delete().in("id", eventIds)).error);
  }
  if (venueIds.length > 0) {
    fail("venues", (await service.from("venues").delete().in("id", venueIds)).error);
  }
  for (const user of fixtureUsers) {
    fail(`auth user ${user.phone}`, (await service.auth.admin.deleteUser(user.id)).error);
  }
}

/**
 * One promoted dance: its own event, its own paid order, one promotion row.
 *
 * Each case gets a distinct event and — where it matters — a distinct area, so
 * migration 0016's five-per-area cap never fires for a reason that has nothing
 * to do with what is being asserted here.
 */
async function promoteNewDance(options: {
  venueId: string;
  area: string;
  status: "pending_provider_confirmation" | "paid";
  startsInDays: number;
  endsInDays: number;
  cancelled?: boolean;
}): Promise<{ eventId: string; orderId: string; promotionId: string }> {
  const eventId = unwrapId(
    await service
      .from("dance_events")
      .insert({ instructor_id: instructorId, venue_id: options.venueId, price_agorot: 4000 })
      .select("id")
      .single(),
    "dance_events",
  );

  const orderId = unwrapId(
    await service
      .from("orders")
      .insert({
        buyer_id: instructorUserId,
        instructor_id: instructorId,
        kind: "sponsored_promotion",
        status: options.status,
        gross_amount_agorot: 10000,
        // A promotion order leaves the instructor no payout — migration 0016's
        // orders_sponsored_promotion_has_no_payout.
        platform_fee_agorot: 10000,
        provider_fee_agorot: 0,
        provider_transaction_id:
          options.status === "paid" ? `${FIXTURE_PREFIX}txn-${eventId}` : null,
      })
      .select("id")
      .single(),
    "promotion order",
  );

  const promotionId = unwrapId(
    await service
      .from("sponsored_promotions")
      .insert({
        instructor_id: instructorId,
        event_id: eventId,
        order_id: orderId,
        area: options.area,
        starts_at: daysFromNow(options.startsInDays, 0),
        ends_at: daysFromNow(options.endsInDays, 0),
        cancelled_at: options.cancelled ? new Date().toISOString() : null,
      })
      .select("id")
      .single(),
    "sponsored_promotion",
  );

  return { eventId, orderId, promotionId };
}

beforeAll(async () => {
  service = serviceClient();
  anon = anonClient();
  await cleanUp();

  dancer = await signInAs(PHONE_DANCER);

  const { data: created, error } = await service.auth.admin.createUser({
    phone: PHONE_INSTRUCTOR,
    phone_confirm: true,
  });
  if (error || !created.user) throw new Error(`could not create the instructor user: ${error?.message}`);
  instructorUserId = created.user.id;

  const profile = await service
    .from("profiles")
    .insert({ id: instructorUserId, display_name: "מרקיד ממומן", phone: PHONE_INSTRUCTOR });
  if (profile.error) throw profile.error;

  instructorId = unwrapId(
    await service
      .from("instructors")
      .insert({ profile_id: instructorUserId, display_name: "דנה" })
      .select("id")
      .single(),
    "instructor",
  );

  const venueId = unwrapId(
    await service
      .from("venues")
      .insert({
        name: `${FIXTURE_PREFIX}hall`,
        address: "מרכז הקהילה, מצפה רמון",
        // Far from every other suite's fixtures, for the reason
        // tests/rls/payments.test.ts states.
        location: point(34.801, 30.61),
      })
      .select("id")
      .single(),
    "venue",
  );

  promotedEventId = (
    await promoteNewDance({ venueId, area: AREA, status: "paid", startsInDays: -1, endsInDays: 7 })
  ).eventId;

  // Checkout started, provider never confirmed. Migration 0016 lets this hold
  // an area slot; migration 0017 must not let it buy a place in the list.
  pendingEventId = (
    await promoteNewDance({
      venueId,
      area: `${AREA} א`,
      status: "pending_provider_confirmation",
      startsInDays: -1,
      endsInDays: 7,
    })
  ).eventId;

  // Paid, then the payment fell over. The promotion row can only be inserted
  // against a live order (check_sponsored_promotion_order), so the order is
  // moved to 'failed' afterwards — which is how this happens in real life too.
  const failed = await promoteNewDance({
    venueId,
    area: `${AREA} ב`,
    status: "paid",
    startsInDays: -1,
    endsInDays: 7,
  });
  failedEventId = failed.eventId;
  const failedUpdate = await service
    .from("orders")
    .update({ status: "failed" })
    .eq("id", failed.orderId);
  if (failedUpdate.error) throw failedUpdate.error;

  cancelledEventId = (
    await promoteNewDance({
      venueId,
      area: `${AREA} ג`,
      status: "paid",
      startsInDays: -1,
      endsInDays: 7,
      cancelled: true,
    })
  ).eventId;

  notStartedEventId = (
    await promoteNewDance({ venueId, area: `${AREA} ד`, status: "paid", startsInDays: 3, endsInDays: 10 })
  ).eventId;

  endedEventId = (
    await promoteNewDance({ venueId, area: `${AREA} ה`, status: "paid", startsInDays: -10, endsInDays: -2 })
  ).eventId;

  otherAreaEventId = (
    await promoteNewDance({ venueId, area: OTHER_AREA, status: "paid", startsInDays: -1, endsInDays: 7 })
  ).eventId;
});

afterAll(async () => {
  await cleanUp();
});

/** Only this suite's events — the local stack may hold a developer's own rows. */
function ours(ids: readonly string[]): string[] {
  const mine = new Set([
    promotedEventId,
    pendingEventId,
    failedEventId,
    cancelledEventId,
    notStartedEventId,
    endedEventId,
    otherAreaEventId,
  ]);
  return ids.filter((id) => mine.has(id));
}

describe("the window discloses event ids and nothing else", () => {
  it("lets an anonymous caller run it at all", async () => {
    const { data, error } = await anon.rpc("get_active_promoted_event_ids");

    expect(error).toBeNull();
    // No area given means every area, so both of this suite's paid, live
    // promotions come back — they differ only in their area string.
    expect(ours((data ?? []).map((row) => row.event_id)).sort()).toEqual(
      [promotedEventId, otherAreaEventId].sort(),
    );
  });

  it("returns rows whose ONLY key is event_id", async () => {
    const { data } = await anon.rpc("get_active_promoted_event_ids");

    const row = (data ?? []).find((candidate) => candidate.event_id === promotedEventId);
    expect(row).toBeDefined();
    // The RETURNS TABLE is the allowlist. If a later edit widens it, this fails
    // before anyone has to notice a price in a network response.
    expect(Object.keys(row!)).toEqual(["event_id"]);
  });

  it("still refuses the same caller the table behind it", async () => {
    const { data, error } = await anon.from("sponsored_promotions").select("*");

    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("still refuses the same caller the orders behind it", async () => {
    const { error } = await anon.from("orders").select("*");

    expect(error?.code).toBe("42501");
  });

  it("gives a signed-in dancer the same answer, and no more", async () => {
    const { data, error } = await dancer.rpc("get_active_promoted_event_ids");

    expect(error).toBeNull();
    expect(ours((data ?? []).map((row) => row.event_id)).sort()).toEqual(
      [promotedEventId, otherAreaEventId].sort(),
    );

    const table = await dancer.from("sponsored_promotions").select("id");
    // A dancer is not an instructor, so ownership matches nothing — an empty
    // set rather than a privilege error, because migration 0016 does grant
    // `authenticated` SELECT and scopes it by policy.
    expect(table.error).toBeNull();
    expect(table.data).toEqual([]);
  });
});

describe("a boost has to be paid for", () => {
  it("ignores a promotion whose order never got past pending", async () => {
    const { data } = await anon.rpc("get_active_promoted_event_ids");
    expect((data ?? []).map((row) => row.event_id)).not.toContain(pendingEventId);
  });

  it("ignores a promotion whose payment failed after the fact", async () => {
    const { data } = await anon.rpc("get_active_promoted_event_ids");
    expect((data ?? []).map((row) => row.event_id)).not.toContain(failedEventId);
  });

  it("ignores a cancelled promotion", async () => {
    const { data } = await anon.rpc("get_active_promoted_event_ids");
    expect((data ?? []).map((row) => row.event_id)).not.toContain(cancelledEventId);
  });

  it("ignores a promotion whose window has not opened yet", async () => {
    const { data } = await anon.rpc("get_active_promoted_event_ids");
    expect((data ?? []).map((row) => row.event_id)).not.toContain(notStartedEventId);
  });

  it("ignores a promotion whose window has closed", async () => {
    const { data } = await anon.rpc("get_active_promoted_event_ids");
    expect((data ?? []).map((row) => row.event_id)).not.toContain(endedEventId);
  });

  it("drops a dance from the answer the moment its order is refunded", async () => {
    const before = await anon.rpc("get_active_promoted_event_ids");
    expect((before.data ?? []).map((row) => row.event_id)).toContain(promotedEventId);

    const { data: order } = await service
      .from("sponsored_promotions")
      .select("order_id")
      .eq("event_id", promotedEventId)
      .single();

    const refund = await service
      .from("orders")
      .update({ status: "refunded" })
      .eq("id", order!.order_id);
    if (refund.error) throw refund.error;

    const after = await anon.rpc("get_active_promoted_event_ids");
    expect((after.data ?? []).map((row) => row.event_id)).not.toContain(promotedEventId);

    const restore = await service
      .from("orders")
      .update({ status: "paid" })
      .eq("id", order!.order_id);
    if (restore.error) throw restore.error;
  });
});

describe("the area parameter matches migration 0016's area exactly", () => {
  it("filters to one area when asked", async () => {
    const { data, error } = await anon.rpc("get_active_promoted_event_ids", { p_area: AREA });

    expect(error).toBeNull();
    expect(ours((data ?? []).map((row) => row.event_id))).toEqual([promotedEventId]);
  });

  it("returns a different area's promotions only when asked for that area", async () => {
    const { data } = await anon.rpc("get_active_promoted_event_ids", { p_area: OTHER_AREA });

    expect(ours((data ?? []).map((row) => row.event_id))).toEqual([otherAreaEventId]);
  });

  it("does not match on a near-miss spelling — exact `=`, like the cap", async () => {
    const { data } = await anon.rpc("get_active_promoted_event_ids", { p_area: ` ${AREA}` });
    expect(ours((data ?? []).map((row) => row.event_id))).toEqual([]);

    const prefix = await anon.rpc("get_active_promoted_event_ids", { p_area: AREA.slice(0, 4) });
    expect(ours((prefix.data ?? []).map((row) => row.event_id))).toEqual([]);
  });

  it("omitting the area means every area", async () => {
    const { data } = await anon.rpc("get_active_promoted_event_ids");

    expect(ours((data ?? []).map((row) => row.event_id)).sort()).toEqual(
      [promotedEventId, otherAreaEventId].sort(),
    );
  });

  it("is what the app's own reader calls, and it agrees", async () => {
    const ids = await findActivePromotedEventIds(anon);

    expect(ids.has(promotedEventId)).toBe(true);
    expect(ids.has(pendingEventId)).toBe(false);
  });
});

describe("the function itself cannot become a write surface", () => {
  // Properties of the function's definition rather than of any one call. A
  // future edit that turned this into a plpgsql body, dropped SECURITY DEFINER,
  // unpinned search_path or widened the grant would break one of these.
  it("is SECURITY DEFINER, STABLE, and written in plain SQL", () => {
    const row = runAsPostgres(`
      select p.prosecdef::text || '|' || p.provolatile::text || '|' || l.lanname
      from pg_proc p
      join pg_language l on l.oid = p.prolang
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_active_promoted_event_ids';
    `);

    // 's' is STABLE, which Postgres itself refuses to let write.
    expect(row).toBe("true|s|sql");
  });

  it("pins its search_path", () => {
    const row = runAsPostgres(`
      select coalesce(array_to_string(p.proconfig, ','), '')
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_active_promoted_event_ids';
    `);

    expect(row).toContain("search_path=");
  });

  it("grants EXECUTE to anon and authenticated, and to neither PUBLIC nor service_role", () => {
    const row = runAsPostgres(`
      select coalesce(string_agg(grantee, ',' order by grantee), '')
      from information_schema.routine_privileges
      where specific_schema = 'public'
        and routine_name = 'get_active_promoted_event_ids'
        and privilege_type = 'EXECUTE';
    `);
    const grantees = row.split(",").filter(Boolean);

    expect(grantees).toContain("anon");
    expect(grantees).toContain("authenticated");
    // The two that matter on the other side. PUBLIC is what CREATE FUNCTION
    // hands out by default and what the migration revokes; service_role is
    // excluded deliberately — migration 0006's reasoning, restated in 0017: a
    // caller that already bypasses RLS should read the table directly, where
    // the fact that it is reading commercial data is visible at the call site.
    //
    // The function's OWNER is not asserted against: it holds EXECUTE
    // implicitly, it is named differently across local and hosted stacks, and
    // it is not a client role.
    expect(grantees).not.toContain("PUBLIC");
    expect(grantees).not.toContain("service_role");
  });

  it("returns exactly one output column, named and typed", () => {
    const row = runAsPostgres(`
      select pg_get_function_result(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_active_promoted_event_ids';
    `);

    // The entire output contract in one string. Adding a column — a price, an
    // order id, a window — changes this and fails here.
    expect(row).toBe("TABLE(event_id uuid)");
  });

  it("refuses a service_role call, so the window is not a back door", async () => {
    const { error } = await service.rpc("get_active_promoted_event_ids");

    expect(error).not.toBeNull();
  });
});
