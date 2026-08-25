import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonClient, serviceClient, signInAs, point, type Client } from "./helpers";

/**
 * The payments schema (migration 0016), against a real Postgres.
 *
 * Written from the assumption every RLS file here works from: the application
 * is not the only caller. Anyone holding a session can POST straight to
 * PostgREST with their own token, so nothing below goes through a Server
 * Action — each rule is asserted against a client that skips the app entirely.
 *
 * The stance this file is checking, from the migration's own header: on all
 * five payments tables `authenticated` holds SELECT and nothing else, `anon`
 * holds nothing at all, and the only client-reachable write path is the pair
 * of SECURITY DEFINER RPCs. So the write tests here are not "can the wrong
 * person write" — they are "can ANYONE write from a client", and the answer
 * has to be no every time.
 *
 * Self-contained fixture rather than tests/rls/fixtures.ts, the same choice
 * favorites.test.ts and manageNights.test.ts make: this suite needs paid
 * orders and issued credits that no other file wants, and building them here
 * keeps it independent of another suite's teardown timing.
 */

const PHONE_INSTRUCTOR = "+972500000024";
const PHONE_OTHER_INSTRUCTOR = "+972500000025";
const PHONE_BUYER = "+972500000026";
const PHONE_STRANGER = "+972500000027";

const FIXTURE_PREFIX = "payments-test-";

/** The price every fixture dance carries, in agorot (AGENTS.md §7). */
const PRICE_AGOROT = 4000;

let service: Client;
let anon: Client;
let instructor: Client;
let otherInstructor: Client;
let buyer: Client;
let stranger: Client;

let instructorId: string;
let otherInstructorId: string;
let buyerId: string;
let strangerId: string;

let eventId: string;
let otherEventId: string;
/** The night the buyer already holds a paid ticket for. */
let paidNightId: string;
/** A future night of the same instructor — what a credit gets redeemed against. */
let openNightId: string;
/** A future night belonging to the OTHER instructor. */
let otherNightId: string;

let paidOrderId: string;
let paidTicketId: string;
let creditId: string;
let expiredCreditId: string;
let punchCardId: string;
let promotionId: string;

function daysFromNow(days: number, hourUtc: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return at.toISOString();
}

/**
 * tests/rls/fixtures.ts' helper, with `T extends object` added. Without the
 * constraint TypeScript infers `T` as `null` from the union `.single()`
 * returns, and every fixture row comes back as `never`.
 */
/**
 * The id of the row a fixture insert returned. `.single()`'s response is a
 * union whose `data` member is `Row | null`, which defeats unwrap()'s type
 * inference — so the shape is named here instead of inferred.
 */
function insertedId(
  result: { data: { id: string } | null; error: { message: string } | null },
  what: string,
): string {
  if (result.error) throw new Error(`fixture setup failed (${what}): ${result.error.message}`);
  if (result.data === null) throw new Error(`fixture setup returned no row for ${what}`);
  return result.data.id;
}

function unwrap<T extends object>(
  result: { data: T | null; error: { message: string } | null },
  what: string,
): T {
  if (result.error) throw new Error(`fixture setup failed (${what}): ${result.error.message}`);
  if (result.data === null) throw new Error(`fixture setup returned no row for ${what}`);
  return result.data;
}

/**
 * Teardown, and the order of these deletes is the whole content of it.
 *
 * Migration 0016 puts ON DELETE RESTRICT on every financial foreign key on
 * purpose — a paid order is not something a cascade should be able to erase —
 * so nothing here comes down on its own and the sequence has to run
 * dependency-last-first. Two of them are easy to get wrong:
 *
 *   * orders.applied_credit_id points AT a credit while credits.source_order_id
 *     points BACK at an order. The cycle has to be broken by nulling the
 *     forward reference first, or the credit delete is refused and every delete
 *     behind it stalls.
 *   * credits.source_ticket_id means credits go before tickets, and
 *     tickets.order_id means tickets go before orders.
 *
 * Every result is checked. A teardown that fails quietly leaves fixture rows
 * inside a 50km radius of another suite's proximity assertions, which is a
 * failure in a file that has nothing to do with this one.
 */
async function cleanUp(): Promise<void> {
  const fail = (what: string, error: { message: string } | null): void => {
    if (error) throw new Error(`payments teardown failed (${what}): ${error.message}`);
  };

  const { data: users } = await service.auth.admin.listUsers();
  const phones = new Set(
    [PHONE_INSTRUCTOR, PHONE_OTHER_INSTRUCTOR, PHONE_BUYER, PHONE_STRANGER].map((phone) =>
      phone.replace("+", ""),
    ),
  );
  const fixtureUsers = (users?.users ?? []).filter(
    (user) => user.phone && phones.has(user.phone),
  );
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

  if (userIds.length > 0) {
    const { data: orders } = await service.from("orders").select("id").in("buyer_id", userIds);
    const orderIds = (orders ?? []).map((order) => order.id);

    if (orderIds.length > 0) {
      fail(
        "sponsored_promotions",
        (await service.from("sponsored_promotions").delete().in("order_id", orderIds)).error,
      );

      // The cycle cannot be broken by nulling orders.applied_credit_id —
      // orders_credit_reference_matches_amount ties that column to
      // credit_applied_agorot, so clearing one without the other is refused,
      // and clearing both would rewrite the money on a paid order just to make
      // teardown convenient. It is unwound in dependency order instead: an
      // order that SPENT a credit is deleted before the credit itself, which is
      // then deleted before the ticket it was issued against.
      const { data: spending } = await service
        .from("orders")
        .select("id")
        .in("id", orderIds)
        .not("applied_credit_id", "is", null);
      const spendingIds = (spending ?? []).map((order) => order.id);

      if (spendingIds.length > 0) {
        fail(
          "tickets bought with a credit",
          (await service.from("tickets").delete().in("order_id", spendingIds)).error,
        );
        fail(
          "orders that spent a credit",
          (await service.from("orders").delete().in("id", spendingIds)).error,
        );
      }
    }

    fail("credits", (await service.from("credits").delete().in("buyer_id", userIds)).error);
    fail("tickets", (await service.from("tickets").delete().in("buyer_id", userIds)).error);
    fail("punch_cards", (await service.from("punch_cards").delete().in("buyer_id", userIds)).error);

    if (orderIds.length > 0) {
      fail("orders", (await service.from("orders").delete().in("id", orderIds)).error);
    }
  }

  if (eventIds.length > 0) {
    fail(
      "sponsored_promotions by event",
      (await service.from("sponsored_promotions").delete().in("event_id", eventIds)).error,
    );
    fail(
      "event_occurrences",
      (await service.from("event_occurrences").delete().in("event_id", eventIds)).error,
    );
    fail("dance_events", (await service.from("dance_events").delete().in("id", eventIds)).error);
  }

  if (venueIds.length > 0) {
    fail("venues", (await service.from("venues").delete().in("id", venueIds)).error);
  }

  for (const user of fixtureUsers) {
    const { error } = await service.auth.admin.deleteUser(user.id);
    fail(`auth user ${user.phone}`, error);
  }
}

beforeAll(async () => {
  service = serviceClient();
  anon = anonClient();
  await cleanUp();

  instructor = await signInAs(PHONE_INSTRUCTOR);
  otherInstructor = await signInAs(PHONE_OTHER_INSTRUCTOR);
  buyer = await signInAs(PHONE_BUYER);
  stranger = await signInAs(PHONE_STRANGER);

  const idOf = async (client: Client): Promise<string> => {
    const { data } = await client.auth.getUser();
    if (!data.user) throw new Error("signed-in client has no user");
    return data.user.id;
  };
  const instructorProfileId = await idOf(instructor);
  const otherInstructorProfileId = await idOf(otherInstructor);
  buyerId = await idOf(buyer);
  strangerId = await idOf(stranger);

  await service.from("profiles").insert([
    { id: instructorProfileId, display_name: "מרקידה", phone: PHONE_INSTRUCTOR },
    { id: otherInstructorProfileId, display_name: "מרקיד אחר", phone: PHONE_OTHER_INSTRUCTOR },
    { id: buyerId, display_name: "רוקדת", phone: PHONE_BUYER },
    { id: strangerId, display_name: "רוקד זר", phone: PHONE_STRANGER },
  ]);

  const instructors = unwrap(
    await service
      .from("instructors")
      .insert([
        { profile_id: instructorProfileId, display_name: "דנה" },
        { profile_id: otherInstructorProfileId, display_name: "יוסי" },
      ])
      .select("id, profile_id"),
    "instructors",
  );
  instructorId = instructors.find((row) => row.profile_id === instructorProfileId)!.id;
  otherInstructorId = instructors.find((row) => row.profile_id === otherInstructorProfileId)!.id;

  const venue = insertedId(
    await service
      .from("venues")
      .insert({
        name: `${FIXTURE_PREFIX}hall`,
        // Deliberately nowhere near any other suite's fixtures. Migration
        // 0002's find_dances_near clamps to a 50km radius, and Mitzpe Ramon is
        // ~130km from the nearest seeded or fixture venue — so even if this
        // file's teardown ever fails again, its rows cannot turn up inside
        // another file's proximity assertion.
        address: "מרכז הקהילה, מצפה רמון",
        location: point(34.8010, 30.6100),
      })
      .select("id")
      .single(),
    "venue",
  );

  const events = unwrap(
    await service
      .from("dance_events")
      .insert([
        { instructor_id: instructorId, venue_id: venue, price_agorot: PRICE_AGOROT },
        { instructor_id: otherInstructorId, venue_id: venue, price_agorot: PRICE_AGOROT },
      ])
      .select("id, instructor_id"),
    "dance_events",
  );
  eventId = events.find((row) => row.instructor_id === instructorId)!.id;
  otherEventId = events.find((row) => row.instructor_id === otherInstructorId)!.id;

  const occurrences = unwrap(
    await service
      .from("event_occurrences")
      .insert([
        {
          event_id: eventId,
          starts_at: daysFromNow(3, 17),
          ends_at: daysFromNow(3, 20),
          status: "scheduled",
        },
        {
          event_id: eventId,
          starts_at: daysFromNow(9, 17),
          ends_at: daysFromNow(9, 20),
          status: "scheduled",
        },
        {
          event_id: otherEventId,
          starts_at: daysFromNow(12, 17),
          ends_at: daysFromNow(12, 20),
          status: "scheduled",
        },
      ])
      .select("id, event_id, starts_at"),
    "event_occurrences",
  );
  const at = (eventOf: string, days: number): string =>
    occurrences.find(
      (row) => row.event_id === eventOf && Date.parse(row.starts_at) === Date.parse(daysFromNow(days, 17)),
    )!.id;
  paidNightId = at(eventId, 3);
  openNightId = at(eventId, 9);
  otherNightId = at(otherEventId, 12);

  // A settled ticket sale: the buyer paid, the platform kept 400, the provider
  // took 100, the instructor is owed 3500.
  const paidOrder = insertedId(
    await service
      .from("orders")
      .insert({
        buyer_id: buyerId,
        instructor_id: instructorId,
        kind: "ticket",
        status: "paid",
        gross_amount_agorot: PRICE_AGOROT,
        platform_fee_agorot: 400,
        provider_fee_agorot: 100,
        provider_transaction_id: `${FIXTURE_PREFIX}txn-ticket`,
        provider_confirmed_at: new Date().toISOString(),
      })
      .select("id")
      .single(),
    "paid order",
  );
  paidOrderId = paidOrder;

  const paidTicket = insertedId(
    await service
      .from("tickets")
      .insert({ buyer_id: buyerId, order_id: paidOrderId, occurrence_id: paidNightId })
      .select("id")
      .single(),
    "paid ticket",
  );
  paidTicketId = paidTicket;

  // What the instructor cancelling that night leaves behind.
  const credit = insertedId(
    await service
      .from("credits")
      .insert({
        buyer_id: buyerId,
        instructor_id: instructorId,
        source_order_id: paidOrderId,
        source_ticket_id: paidTicketId,
        amount_agorot: PRICE_AGOROT,
        remaining_agorot: PRICE_AGOROT,
      })
      .select("id")
      .single(),
    "credit",
  );
  creditId = credit;

  // A credit whose 90 days have already run out — the refund-request path.
  // issued_at is pushed back with it, because credits_expiry_after_issue
  // requires expires_at to be later than issued_at.
  const expiredCredit = insertedId(
    await service
      .from("credits")
      .insert({
        buyer_id: buyerId,
        instructor_id: instructorId,
        source_order_id: paidOrderId,
        amount_agorot: 2500,
        remaining_agorot: 2500,
        issued_at: daysFromNow(-100, 12),
        expires_at: daysFromNow(-10, 12),
      })
      .select("id")
      .single(),
    "expired credit",
  );
  expiredCreditId = expiredCredit;

  const punchOrder = insertedId(
    await service
      .from("orders")
      .insert({
        buyer_id: buyerId,
        instructor_id: instructorId,
        kind: "punch_card",
        status: "paid",
        gross_amount_agorot: 30000,
        platform_fee_agorot: 3000,
        provider_fee_agorot: 500,
        provider_transaction_id: `${FIXTURE_PREFIX}txn-card`,
      })
      .select("id")
      .single(),
    "punch card order",
  );
  const punchCard = insertedId(
    await service
      .from("punch_cards")
      .insert({
        order_id: punchOrder,
        buyer_id: buyerId,
        instructor_id: instructorId,
        total_uses: 10,
        remaining_uses: 10,
      })
      .select("id")
      .single(),
    "punch card",
  );
  punchCardId = punchCard;

  // The instructor buying promotion FROM the platform: no payout, no split.
  const promoOrder = insertedId(
    await service
      .from("orders")
      .insert({
        buyer_id: instructorProfileId,
        instructor_id: instructorId,
        kind: "sponsored_promotion",
        status: "paid",
        gross_amount_agorot: 10000,
        platform_fee_agorot: 9800,
        provider_fee_agorot: 200,
        provider_transaction_id: `${FIXTURE_PREFIX}txn-promo`,
      })
      .select("id")
      .single(),
    "promotion order",
  );
  const promotion = insertedId(
    await service
      .from("sponsored_promotions")
      .insert({
        instructor_id: instructorId,
        event_id: eventId,
        order_id: promoOrder,
        area: "תל אביב",
        starts_at: daysFromNow(0, 0),
        ends_at: daysFromNow(7, 0),
      })
      .select("id")
      .single(),
    "sponsored promotion",
  );
  promotionId = promotion;
});

afterAll(async () => {
  await cleanUp();
});

const PAYMENT_TABLES = [
  "orders",
  "tickets",
  "punch_cards",
  "credits",
  "sponsored_promotions",
] as const;

describe("anon reaches none of it", () => {
  // Unlike venues, dance_events and event_occurrences — which anon reads because
  // the map IS the product (AGENTS.md §2.1) — none of these tables carry a grant
  // to anon at all, so the refusal happens at the privilege layer before RLS is
  // consulted. 42501 is that refusal, not an empty result set.
  it.each(PAYMENT_TABLES)("refuses an anonymous read of %s", async (table) => {
    const { data, error } = await anon.from(table).select("*");
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("refuses an anonymous credit redemption", async () => {
    const { error } = await anon.rpc("redeem_credit_for_ticket", {
      p_credit_id: creditId,
      p_occurrence_id: openNightId,
    });
    expect(error).not.toBeNull();
  });

  it("refuses an anonymous refund request", async () => {
    const { error } = await anon.rpc("request_credit_refund", { p_credit_id: expiredCreditId });
    expect(error).not.toBeNull();
  });
});

describe("a buyer sees their own money and nobody else's", () => {
  it("reads their own order, with the payout the instructor is owed", async () => {
    const { data, error } = await buyer.from("orders").select("*").eq("id", paidOrderId).single();
    expect(error).toBeNull();
    expect(data?.gross_amount_agorot).toBe(PRICE_AGOROT);
    expect(data?.charged_amount_agorot).toBe(PRICE_AGOROT);
    expect(data?.instructor_payout_agorot).toBe(3500);
  });

  it("reads their own ticket, punch card and credits", async () => {
    const tickets = await buyer.from("tickets").select("id").eq("id", paidTicketId);
    expect(tickets.data).toHaveLength(1);

    const cards = await buyer.from("punch_cards").select("remaining_uses").eq("id", punchCardId);
    expect(cards.data?.[0]?.remaining_uses).toBe(10);

    const credits = await buyer.from("credits").select("id");
    expect(credits.data?.map((row) => row.id).sort()).toEqual([creditId, expiredCreditId].sort());
  });

  it("does not let another signed-in dancer read any of it", async () => {
    for (const table of ["orders", "tickets", "punch_cards", "credits"] as const) {
      const { data, error } = await stranger.from(table).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });
});

describe("an instructor sees the sales, not the dancer's balance", () => {
  it("reads orders where they are the counterparty", async () => {
    const { data, error } = await instructor.from("orders").select("id, kind");
    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toContain(paidOrderId);
  });

  it("reads the tickets issued for their own nights", async () => {
    const { data, error } = await instructor.from("tickets").select("id");
    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toContain(paidTicketId);
  });

  it("reads the punch cards sold against them", async () => {
    const { data } = await instructor.from("punch_cards").select("id");
    expect(data?.map((row) => row.id)).toContain(punchCardId);
  });

  it("reads their own sponsored promotions", async () => {
    const { data } = await instructor.from("sponsored_promotions").select("id, area");
    expect(data?.map((row) => row.id)).toEqual([promotionId]);
  });

  // Deliberate, and the one asymmetry in this schema worth restating: a credit is
  // a claim the DANCER holds. The instructor's own liability is derivable from
  // the orders they can already see; a per-dancer balance sheet is not something
  // any stated feature needs (AGENTS.md §8).
  it("cannot read the buyer's credits", async () => {
    const { data, error } = await instructor.from("credits").select("id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("shows a second instructor none of the first one's rows", async () => {
    for (const table of PAYMENT_TABLES) {
      const { data, error } = await otherInstructor.from(table).select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
  });
});

describe("no client writes money, whoever they are", () => {
  // The point of these is not "the wrong person is refused" — it is that the
  // RIGHT person is refused too. There is no INSERT/UPDATE/DELETE grant on any
  // of these tables for `authenticated`, so a price, a fee or a balance can only
  // ever be set server-side (AGENTS.md §8).
  it.each(PAYMENT_TABLES)("refuses a signed-in insert into %s", async (table) => {
    const { error } = await buyer.from(table).insert({} as never);
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("refuses the buyer an order of their own invention", async () => {
    const { error } = await buyer.from("orders").insert({
      buyer_id: buyerId,
      instructor_id: instructorId,
      kind: "ticket",
      status: "paid",
      gross_amount_agorot: 1,
    });
    expect(error?.code).toBe("42501");
  });

  it("refuses the buyer marking their own pending order paid", async () => {
    const { error } = await buyer.from("orders").update({ status: "paid" }).eq("id", paidOrderId);
    expect(error?.code).toBe("42501");
  });

  it("refuses the buyer topping up their own credit", async () => {
    const { error } = await buyer
      .from("credits")
      .update({ remaining_agorot: 999_999 })
      .eq("id", creditId);
    expect(error?.code).toBe("42501");

    const { data } = await service.from("credits").select("remaining_agorot").eq("id", creditId).single();
    expect(data?.remaining_agorot).toBe(PRICE_AGOROT);
  });

  it("refuses the buyer punching their own card", async () => {
    const { error } = await buyer
      .from("punch_cards")
      .update({ remaining_uses: 10_000 })
      .eq("id", punchCardId);
    expect(error?.code).toBe("42501");
  });

  it("refuses an instructor minting themselves a promotion", async () => {
    const { error } = await instructor.from("sponsored_promotions").insert({
      instructor_id: instructorId,
      event_id: eventId,
      order_id: paidOrderId,
      area: "חיפה",
      starts_at: daysFromNow(1, 0),
      ends_at: daysFromNow(2, 0),
    });
    expect(error?.code).toBe("42501");
  });

  it("refuses the buyer deleting the record of a purchase", async () => {
    const { error } = await buyer.from("orders").delete().eq("id", paidOrderId);
    expect(error?.code).toBe("42501");
  });
});

describe("redeem_credit_for_ticket", () => {
  it("refuses a credit that belongs to somebody else", async () => {
    const { error } = await stranger.rpc("redeem_credit_for_ticket", {
      p_credit_id: creditId,
      p_occurrence_id: openNightId,
    });
    expect(error?.message).toContain("no such credit");
  });

  it("refuses a night run by a different instructor", async () => {
    const { error } = await buyer.rpc("redeem_credit_for_ticket", {
      p_credit_id: creditId,
      p_occurrence_id: otherNightId,
    });
    expect(error?.message).toContain("instructor who issued it");
  });

  it("refuses a credit whose 90 days have run out", async () => {
    const { error } = await buyer.rpc("redeem_credit_for_ticket", {
      p_credit_id: expiredCreditId,
      p_occurrence_id: openNightId,
    });
    expect(error?.message).toContain("expired");
  });

  it("spends the credit on the instructor's own night, and closes it", async () => {
    const { data, error } = await buyer.rpc("redeem_credit_for_ticket", {
      p_credit_id: creditId,
      p_occurrence_id: openNightId,
    });
    expect(error).toBeNull();

    const redeemed = data?.[0];
    expect(redeemed?.credit_applied_agorot).toBe(PRICE_AGOROT);
    expect(redeemed?.credit_remaining_agorot).toBe(0);
    expect(redeemed?.ticket_id).not.toBeNull();

    // The order it produced needs no provider: credit covered all of it, so
    // nothing is charged and the instructor is still owed the full gross.
    const { data: order } = await service
      .from("orders")
      .select("*")
      .eq("id", redeemed!.order_id)
      .single();
    expect(order?.status).toBe("paid");
    expect(order?.charged_amount_agorot).toBe(0);
    expect(order?.credit_applied_agorot).toBe(PRICE_AGOROT);
    expect(order?.instructor_payout_agorot).toBe(PRICE_AGOROT);
    expect(order?.provider_transaction_id).toBeNull();
    expect(order?.applied_credit_id).toBe(creditId);

    const { data: credit } = await service.from("credits").select("*").eq("id", creditId).single();
    expect(credit?.status).toBe("redeemed");
    expect(credit?.remaining_agorot).toBe(0);

    // And the buyer can see the ticket it minted, through their own token.
    const { data: ticket } = await buyer
      .from("tickets")
      .select("occurrence_id, status")
      .eq("id", redeemed!.ticket_id!)
      .single();
    expect(ticket?.occurrence_id).toBe(openNightId);
    expect(ticket?.status).toBe("valid");
  });

  it("refuses to spend the same credit twice", async () => {
    const { error } = await buyer.rpc("redeem_credit_for_ticket", {
      p_credit_id: creditId,
      p_occurrence_id: openNightId,
    });
    expect(error?.message).toContain("redeemed");
  });
});

describe("request_credit_refund", () => {
  it("refuses a credit that is still inside its 90 days", async () => {
    const stillLive = insertedId(
      await service
        .from("credits")
        .insert({
          buyer_id: buyerId,
          instructor_id: instructorId,
          source_order_id: paidOrderId,
          amount_agorot: 1000,
          remaining_agorot: 1000,
        })
        .select("id")
        .single(),
      "live credit",
    );

    const { error } = await buyer.rpc("request_credit_refund", { p_credit_id: stillLive });
    expect(error?.message).toContain("still usable");
  });

  it("refuses a credit belonging to somebody else", async () => {
    const { error } = await stranger.rpc("request_credit_refund", {
      p_credit_id: expiredCreditId,
    });
    expect(error?.message).toContain("no such credit");
  });

  it("records the request and reports the fee the instructor absorbs", async () => {
    const { data, error } = await buyer.rpc("request_credit_refund", {
      p_credit_id: expiredCreditId,
    });
    expect(error).toBeNull();

    const requested = data?.[0];
    expect(requested?.refund_amount_agorot).toBe(2500);
    // The ORIGINAL processing fee, off the order the credit came out of — the
    // confirmed policy is that the instructor, not the buyer, absorbs it.
    expect(requested?.instructor_absorbed_fee_agorot).toBe(100);

    const { data: credit } = await service
      .from("credits")
      .select("status, refund_requested_at")
      .eq("id", expiredCreditId)
      .single();
    expect(credit?.status).toBe("expired");
    expect(credit?.refund_requested_at).not.toBeNull();
  });

  it("refuses a second request for the same credit", async () => {
    const { error } = await buyer.rpc("request_credit_refund", {
      p_credit_id: expiredCreditId,
    });
    expect(error?.message).toContain("already been requested");
  });

  it("refuses to redeem a credit a refund has been asked for", async () => {
    const { error } = await buyer.rpc("redeem_credit_for_ticket", {
      p_credit_id: expiredCreditId,
      p_occurrence_id: openNightId,
    });
    expect(error).not.toBeNull();
  });
});

describe("invariants the database holds, whoever is writing", () => {
  // service_role bypasses RLS, so these assert the rules that survive it —
  // the ones that must hold even for the payment webhook.

  it("refuses a ticket against an order that is not paid", async () => {
    const pending = insertedId(
      await service
        .from("orders")
        .insert({
          buyer_id: buyerId,
          instructor_id: instructorId,
          kind: "ticket",
          gross_amount_agorot: PRICE_AGOROT,
        })
        .select("id")
        .single(),
      "pending order",
    );

    const { error } = await service
      .from("tickets")
      .insert({ buyer_id: buyerId, order_id: pending, occurrence_id: openNightId });
    expect(error?.message).toContain("cannot issue a ticket");

    await service.from("orders").delete().eq("id", pending);
  });

  it("refuses a ticket whose night belongs to a different instructor", async () => {
    const { error } = await service
      .from("tickets")
      .insert({ buyer_id: buyerId, order_id: paidOrderId, occurrence_id: otherNightId });
    expect(error?.message).toContain("was paid to instructor");
  });

  it("refuses a ticket attributed to someone other than the order's buyer", async () => {
    const { error } = await service
      .from("tickets")
      .insert({ buyer_id: strangerId, order_id: paidOrderId, occurrence_id: paidNightId });
    expect(error).not.toBeNull();
  });

  it("refuses a credit scoped to an instructor the order never paid", async () => {
    const { error } = await service.from("credits").insert({
      buyer_id: buyerId,
      instructor_id: otherInstructorId,
      source_order_id: paidOrderId,
      amount_agorot: 100,
      remaining_agorot: 100,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a sponsored promotion order that leaves the instructor a payout", async () => {
    const { error } = await service.from("orders").insert({
      buyer_id: buyerId,
      instructor_id: instructorId,
      kind: "sponsored_promotion",
      gross_amount_agorot: 10000,
      platform_fee_agorot: 100,
      provider_fee_agorot: 0,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a paid order with no provider transaction behind it", async () => {
    const { error } = await service.from("orders").insert({
      buyer_id: buyerId,
      instructor_id: instructorId,
      kind: "ticket",
      status: "paid",
      gross_amount_agorot: PRICE_AGOROT,
    });
    expect(error).not.toBeNull();
  });

  it("refuses a replayed provider transaction id", async () => {
    const { error } = await service.from("orders").insert({
      buyer_id: buyerId,
      instructor_id: instructorId,
      kind: "ticket",
      status: "paid",
      gross_amount_agorot: PRICE_AGOROT,
      provider_transaction_id: `${FIXTURE_PREFIX}txn-ticket`,
    });
    expect(error?.code).toBe("23505");
  });

  it("caps sponsored promotions per area, counting only overlapping windows", async () => {
    const promote = async (
      area: string,
      startDay: number,
      endDay: number,
    ): Promise<string | null> => {
      const order = insertedId(
        await service
          .from("orders")
          .insert({
            buyer_id: buyerId,
            instructor_id: instructorId,
            kind: "sponsored_promotion",
            status: "paid",
            gross_amount_agorot: 10000,
            platform_fee_agorot: 10000,
            provider_fee_agorot: 0,
            provider_transaction_id: `${FIXTURE_PREFIX}cap-${area}-${startDay}-${endDay}`,
          })
          .select("id")
          .single(),
        "cap order",
      );
      const { error } = await service.from("sponsored_promotions").insert({
        instructor_id: instructorId,
        event_id: eventId,
        order_id: order,
        area,
        starts_at: daysFromNow(startDay, 0),
        ends_at: daysFromNow(endDay, 0),
      });
      return error?.message ?? null;
    };

    // One promotion in "תל אביב" already exists from the fixture, so four more
    // fill the provisional cap of five.
    for (let i = 0; i < 4; i += 1) {
      expect(await promote("תל אביב", i, 7)).toBeNull();
    }
    expect(await promote("תל אביב", 5, 7)).toContain("the cap is 5");

    // A different area is unaffected, and so is a window that does not overlap.
    expect(await promote("ירושלים", 0, 7)).toBeNull();
    expect(await promote("תל אביב", 40, 47)).toBeNull();
  });

  it("refuses a promotion attached to an order that bought something else", async () => {
    const { error } = await service.from("sponsored_promotions").insert({
      instructor_id: instructorId,
      event_id: eventId,
      // This order bought a ticket, not a promotion.
      order_id: paidOrderId,
      area: "אשדוד",
      starts_at: daysFromNow(1, 0),
      ends_at: daysFromNow(2, 0),
    });
    expect(error?.message).toContain("not a promotion");
  });

  it("refuses an area string that is not trimmed, so the cap cannot be split", async () => {
    const order = insertedId(
      await service
        .from("orders")
        .insert({
          buyer_id: buyerId,
          instructor_id: instructorId,
          kind: "sponsored_promotion",
          status: "paid",
          gross_amount_agorot: 10000,
          platform_fee_agorot: 10000,
          provider_fee_agorot: 0,
          provider_transaction_id: `${FIXTURE_PREFIX}untrimmed`,
        })
        .select("id")
        .single(),
      "untrimmed order",
    );

    const { error } = await service.from("sponsored_promotions").insert({
      instructor_id: instructorId,
      event_id: eventId,
      order_id: order,
      area: " תל אביב",
      starts_at: daysFromNow(1, 0),
      ends_at: daysFromNow(2, 0),
    });
    expect(error).not.toBeNull();
  });

  it("refuses to delete a night somebody holds a ticket for", async () => {
    const { error } = await service.from("event_occurrences").delete().eq("id", paidNightId);
    expect(error).not.toBeNull();

    const { data } = await service.from("event_occurrences").select("id").eq("id", paidNightId);
    expect(data).toHaveLength(1);
  });

  it("spends one punch per night and never the same night twice", async () => {
    const night = insertedId(
      await service
        .from("event_occurrences")
        .insert({
          event_id: eventId,
          starts_at: daysFromNow(21, 17),
          ends_at: daysFromNow(21, 20),
          status: "scheduled",
        })
        .select("id")
        .single(),
      "punch night",
    );

    const first = await service
      .from("tickets")
      .insert({ buyer_id: buyerId, punch_card_id: punchCardId, occurrence_id: night });
    expect(first.error).toBeNull();

    const { data: afterOne } = await service
      .from("punch_cards")
      .select("remaining_uses")
      .eq("id", punchCardId)
      .single();
    expect(afterOne?.remaining_uses).toBe(9);

    const second = await service
      .from("tickets")
      .insert({ buyer_id: buyerId, punch_card_id: punchCardId, occurrence_id: night });
    expect(second.error?.code).toBe("23505");

    const { data: afterTwo } = await service
      .from("punch_cards")
      .select("remaining_uses")
      .eq("id", punchCardId)
      .single();
    expect(afterTwo?.remaining_uses).toBe(9);
  });
});
