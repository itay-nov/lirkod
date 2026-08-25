import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { he } from "../../src/lib/i18n/he";
import type { Database } from "../../src/types/database";

/**
 * /profile/purchases end to end: a dancer's tickets, punch card and credits
 * (migration 0016, docs/decisions/0025), and the P1 case this file exists to
 * prove closed — the instructor whose own dance a ticket was bought for must
 * NOT see that purchase on their own purchases page. /profile/purchases shows
 * what the signed-in user bought, never what was sold on their dances.
 *
 * Both identities here are throwaway fixtures this file creates and tears
 * down itself, the same pattern every other e2e/RLS suite in this repo uses
 * (admin.createUser + a registered test OTP number) — not the seeded baseline
 * instructor from supabase/seed.sql. That seeded row's phone is stored WITH a
 * leading "+" (`+972500000100`), which GoTrue's own normalisation does not use
 * (src/lib/domain/phone.ts documents "GoTrue's own `user.phone`" as stored
 * WITHOUT the plus) — signing in through the browser as that seeded phone
 * creates a second, orphaned auth.users row instead of authenticating as the
 * intended instructor. That is a pre-existing supabase/seed.sql inconsistency,
 * out of scope for this file to fix, and sidestepped entirely by minting an
 * instructor this file controls end to end.
 */

test.describe.configure({ mode: "serial" });

const PHONE_DANCER_E164 = "+972500000045";
const PHONE_DANCER_LOCAL = "050-0000045";
const PHONE_INSTRUCTOR_E164 = "+972500000046";
const PHONE_INSTRUCTOR_LOCAL = "050-0000046";
const TEST_OTP = "123456";
const DANCER_NAME = "רוקד כרטיסים";

/** Only this suite's rows are named with this prefix, so teardown finds exactly what it created. */
const FIXTURE_PREFIX = "e2e-purchases-";

interface LocalStack {
  apiUrl: string;
  serviceRoleKey: string;
}

let stack: LocalStack | undefined;

function localStack(): LocalStack {
  if (stack) return stack;

  let raw: string;
  try {
    raw = execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "Local Supabase stack not running. Run `npm run db:start` before the E2E suite."
    );
  }

  const parsed = JSON.parse(raw);
  stack = {
    apiUrl: parsed.API_URL,
    serviceRoleKey: parsed.SERVICE_ROLE_KEY,
  };
  return stack;
}

function serviceClient() {
  const { apiUrl, serviceRoleKey } = localStack();
  return createClient<Database>(apiUrl, serviceRoleKey);
}

/** A point in Tel Aviv, as PostGIS WKT — the same shape tests/rls/*.ts fixtures use. */
function point(lon: number, lat: number): string {
  return `POINT(${lon} ${lat})`;
}

function daysFromNow(days: number, hourUtc: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  at.setUTCHours(hourUtc, 0, 0, 0);
  return at.toISOString();
}

/**
 * Removes exactly what this file creates, and nothing else — matching
 * tests/rls/payments.test.ts's discipline. Every payments-schema foreign key
 * is ON DELETE RESTRICT (migration 0016), so nothing here cascades: rows come
 * down in dependency order, deepest first, or a later delete in the same
 * function fails and leaves the rest behind for the next run to trip over.
 *
 * Called from both beforeAll (start clean, in case a previous run aborted
 * mid-test) and afterAll (leave clean for whatever runs next in the same
 * database) — the exact gap that let one flake in this file corrupt an
 * unrelated later run.
 */
async function cleanUp(client: ReturnType<typeof serviceClient>): Promise<void> {
  const fail = (what: string, error: { message: string } | null): void => {
    if (error) throw new Error(`purchases e2e teardown failed (${what}): ${error.message}`);
  };

  const { data: venues } = await client
    .from("venues")
    .select("id")
    .like("name", `${FIXTURE_PREFIX}%`);
  const venueIds = (venues ?? []).map((venue) => venue.id);

  let eventIds: string[] = [];
  if (venueIds.length > 0) {
    const { data: events } = await client
      .from("dance_events")
      .select("id")
      .in("venue_id", venueIds);
    eventIds = (events ?? []).map((event) => event.id);
  }

  const { data: users } = await client.auth.admin.listUsers();
  const phones = new Set(
    [PHONE_DANCER_E164, PHONE_INSTRUCTOR_E164].map((phone) => phone.replace("+", "")),
  );
  const fixtureUsers = (users?.users ?? []).filter((user) => user.phone && phones.has(user.phone));
  const userIds = fixtureUsers.map((user) => user.id);

  // Deepest first: credits reference tickets and orders; tickets reference
  // punch_cards and orders; punch_cards reference orders. Only once all four
  // are gone can the occurrences, dance, venue and auth users they point at
  // be removed.
  //
  // One cycle inside that: redeem_credit_for_ticket (migration 0016) creates a
  // NEW order whose applied_credit_id points AT the credit it spent. Deleting
  // credits before breaking that forward reference is refused with a foreign
  // key violation — the same shape tests/rls/payments.test.ts documents its
  // own teardown having to unwind. Every result is checked here for exactly
  // that reason: a silently failed delete leaves rows for whatever runs next
  // in the same database to trip over, which is what happened the first time
  // this teardown was written without the check.
  if (userIds.length > 0) {
    const { data: orders } = await client.from("orders").select("id").in("buyer_id", userIds);
    const orderIds = (orders ?? []).map((order) => order.id);
    if (orderIds.length > 0) {
      // Three of migration 0016's own CHECK constraints have to be satisfied
      // together by one UPDATE, not worked around one at a time:
      //   * orders_credit_reference_matches_amount ties applied_credit_id to
      //     credit_applied_agorot — nulling one without the other is refused.
      //   * orders_paid_needs_provider_reference then refuses status 'paid'
      //     with credit_applied_agorot 0 and no provider_transaction_id — the
      //     redemption order in this fixture was born 'paid' on exactly the
      //     credit_applied_agorot = gross_amount_agorot escape hatch that
      //     zeroing the credit just closed.
      // No trigger fires on an orders UPDATE (migration 0016's triggers are
      // all BEFORE/AFTER INSERT on tickets/punch_cards/sponsored_promotions),
      // so moving status off 'paid' here is side-effect-free — these rows are
      // about to be deleted regardless, and rewriting their money fields is
      // safe.
      fail(
        "breaking the orders/credits cycle",
        (
          await client
            .from("orders")
            .update({ applied_credit_id: null, credit_applied_agorot: 0, status: "failed" })
            .in("id", orderIds)
        ).error,
      );
    }

    fail("credits", (await client.from("credits").delete().in("buyer_id", userIds)).error);
    fail("tickets", (await client.from("tickets").delete().in("buyer_id", userIds)).error);
    fail("punch_cards", (await client.from("punch_cards").delete().in("buyer_id", userIds)).error);
    fail("orders", (await client.from("orders").delete().in("buyer_id", userIds)).error);
  }
  if (eventIds.length > 0) {
    fail(
      "event_occurrences",
      (await client.from("event_occurrences").delete().in("event_id", eventIds)).error,
    );
    fail("dance_events", (await client.from("dance_events").delete().in("id", eventIds)).error);
  }
  if (venueIds.length > 0) {
    fail("venues", (await client.from("venues").delete().in("id", venueIds)).error);
  }
  for (const user of fixtureUsers) {
    const { error } = await client.auth.admin.deleteUser(user.id);
    fail(`auth user ${user.phone}`, error);
  }
}

/** The instructor whose dance the dancer buys into, and the two future nights they run. */
let instructorId: string;
let occurrenceIds: [string, string];

test.beforeAll(async () => {
  const client = serviceClient();
  await cleanUp(client);

  const { data: created, error } = await client.auth.admin.createUser({
    phone: PHONE_INSTRUCTOR_E164,
    phone_confirm: true,
  });
  if (error || !created.user) {
    throw new Error(`could not create the instructor user: ${error?.message}`);
  }
  const instructorProfileId = created.user.id;

  // Pre-created, exactly as supabase/seed.sql does for its own instructor: a
  // profiles row means the browser sign-in below goes straight to the
  // profile menu instead of stopping at the "מה השם שלכם?" step, which is not
  // what this file is testing.
  const profileInsert = await client
    .from("profiles")
    .insert({ id: instructorProfileId, display_name: "מרקידה לבדיקה", phone: PHONE_INSTRUCTOR_E164 });
  if (profileInsert.error) throw new Error(`profile insert failed: ${profileInsert.error.message}`);

  const { data: instructorRow, error: instructorError } = await client
    .from("instructors")
    .insert({ profile_id: instructorProfileId, display_name: "דנה הבודקת" })
    .select("id")
    .single();
  if (instructorError || !instructorRow) {
    throw new Error(`instructor insert failed: ${instructorError?.message}`);
  }
  instructorId = instructorRow.id;

  const { data: venue, error: venueError } = await client
    .from("venues")
    .insert({
      name: `${FIXTURE_PREFIX}hall`,
      address: "רחוב הבדיקות 1, תל אביב",
      location: point(34.7818, 32.0853),
    })
    .select("id")
    .single();
  if (venueError || !venue) throw new Error(`venue insert failed: ${venueError?.message}`);

  // price_agorot matches the credit amount used below exactly, so the redeem
  // flow's price <= credit filter (findUpcomingInstructorOccurrences) has
  // something to offer.
  const { data: danceEvent, error: danceEventError } = await client
    .from("dance_events")
    .insert({ instructor_id: instructorId, venue_id: venue.id, price_agorot: 5000 })
    .select("id")
    .single();
  if (danceEventError || !danceEvent) {
    throw new Error(`dance_events insert failed: ${danceEventError?.message}`);
  }

  const { data: occurrences, error: occurrencesError } = await client
    .from("event_occurrences")
    .insert([
      {
        event_id: danceEvent.id,
        starts_at: daysFromNow(3, 18),
        ends_at: daysFromNow(3, 21),
        status: "scheduled",
      },
      {
        event_id: danceEvent.id,
        starts_at: daysFromNow(5, 18),
        ends_at: daysFromNow(5, 21),
        status: "scheduled",
      },
    ])
    .select("id");
  if (occurrencesError || !occurrences || occurrences.length !== 2) {
    throw new Error(`event_occurrences insert failed: ${occurrencesError?.message}`);
  }
  occurrenceIds = [occurrences[0]!.id, occurrences[1]!.id];
});

test.afterAll(async () => {
  await cleanUp(serviceClient());
});

async function signIn(page: Page): Promise<string> {
  await page.goto("/profile");
  await page.getByLabel(he.signIn.phoneLabel).fill(PHONE_DANCER_LOCAL);
  await page.getByRole("button", { name: he.signIn.sendCode }).click();

  const codeField = page.getByLabel(he.signIn.codeLabel);
  await expect(codeField).toBeVisible({ timeout: 20_000 });
  await codeField.fill(TEST_OTP);
  await page.getByRole("button", { name: he.signIn.submitCode, exact: true }).click();

  const nameField = page.getByLabel(he.profileName.label);
  await expect(nameField).toBeVisible({ timeout: 20_000 });
  await nameField.fill(DANCER_NAME);
  await page.getByRole("button", { name: he.profileName.save }).click();
  await expect(page.getByText(he.profile.greeting(DANCER_NAME))).toBeVisible({
    timeout: 20_000,
  });

  const client = serviceClient();
  const { data: users } = await client.auth.admin.listUsers();
  const user = users?.users.find((u) => u.phone === PHONE_DANCER_E164.replace("+", ""));
  if (!user) throw new Error("User not found after signin");
  return user.id;
}

test("Purchases page requires sign-in", async ({ page }) => {
  await page.goto("/profile/purchases");
  await expect(page.getByRole("heading", { name: he.profile.heading })).toBeVisible();
});

test("Purchases flow", async ({ page }) => {
  const userId = await signIn(page);
  const client = serviceClient();
  const [occurrence1Id] = occurrenceIds;

  // Migration 0016's orders_paid_needs_provider_reference (AGENTS.md §8: only
  // a webhook marks an order paid) refuses status "paid" with no
  // provider_transaction_id unless credit_applied_agorot equals the gross —
  // so a fixture that skips the provider needs one anyway.
  const { data: order } = await client.from("orders").insert({
    buyer_id: userId,
    instructor_id: instructorId,
    kind: "ticket",
    status: "paid",
    gross_amount_agorot: 5000,
    provider_transaction_id: `${FIXTURE_PREFIX}ticket-${userId}`,
  }).select().single();

  if (!order) throw new Error("Order creation failed");

  // Insert a ticket
  await client.from("tickets").insert({
    buyer_id: userId,
    order_id: order.id,
    occurrence_id: occurrence1Id,
    status: "valid",
  });

  // Insert a punch card. This needs its OWN paid order — reusing the ticket
  // order above trips check_punch_card_order() (migration 0016), which refuses
  // a punch card whose order.kind is not 'punch_card'.
  const { data: punchOrder } = await client.from("orders").insert({
    buyer_id: userId,
    instructor_id: instructorId,
    kind: "punch_card",
    status: "paid",
    gross_amount_agorot: 30000,
    provider_transaction_id: `${FIXTURE_PREFIX}punchcard-${userId}`,
  }).select().single();
  if (!punchOrder) throw new Error("Punch card order creation failed");

  await client.from("punch_cards").insert({
    buyer_id: userId,
    order_id: punchOrder.id,
    instructor_id: instructorId,
    total_uses: 10,
    remaining_uses: 9,
    status: "active",
  });

  // Insert a credit (active, redeemable)
  await client.from("credits").insert({
    buyer_id: userId,
    source_order_id: order.id,
    instructor_id: instructorId,
    amount_agorot: 5000,
    remaining_agorot: 5000,
    status: "active",
    expires_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
  });

  // Navigate to purchases
  await page.goto("/profile/purchases");
  await expect(page.getByRole("heading", { name: he.purchases.heading })).toBeVisible();

  // Check tap targets and sizing indirectly via Playwright's rendering checks
  // (We'll check some texts)
  await expect(page.getByText(he.purchases.ticketStatuses.valid)).toBeVisible();
  await expect(page.getByText(he.purchases.remainingUses(9, 10))).toBeVisible();

  // Click redeem
  const useCreditBtn = page.getByRole("button", { name: he.purchases.useCredit });
  await expect(useCreditBtn).toBeVisible();

  // Verify button min-height
  const box = await useCreditBtn.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(48);

  await useCreditBtn.click();

  // Select occurrence
  const select = page.getByRole("combobox", { name: he.purchases.selectDanceLabel });
  await expect(select).toBeVisible();

  const selectBox = await select.boundingBox();
  expect(selectBox?.height).toBeGreaterThanOrEqual(48);

  // Both fixture occurrences are priced at exactly the credit amount, so any
  // real option (index 0 is the placeholder) satisfies the price <= credit
  // filter.
  await select.selectOption({ index: 1 });

  const redeemBtn = page.getByRole("button", { name: he.purchases.redeemButton });
  const redeemBox = await redeemBtn.boundingBox();
  expect(redeemBox?.height).toBeGreaterThanOrEqual(48);

  await redeemBtn.click();

  // Expect success message
  await expect(page.getByText(he.purchases.redeemSuccess)).toBeVisible();

  // Insert a credit (expired, refundable).
  //
  // issued_at must predate expires_at (migration 0016's
  // credits_expiry_after_issue) — omitting it defaults issued_at to now(),
  // which is AFTER "yesterday" and fails the insert. That failure was
  // previously silent: the row was never created, `page.reload()` still ran,
  // and the refund-button assertion below just timed out with no explanation.
  const { data: expiredCredit, error: expiredCreditError } = await client
    .from("credits")
    .insert({
      buyer_id: userId,
      source_order_id: order.id,
      instructor_id: instructorId,
      amount_agorot: 5000,
      remaining_agorot: 5000,
      status: "expired",
      issued_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
    })
    .select()
    .single();
  if (expiredCreditError || !expiredCredit) {
    throw new Error(`Expired credit creation failed: ${expiredCreditError?.message}`);
  }

  await page.reload();

  const refundBtn = page.getByRole("button", { name: he.purchases.requestRefund });
  await expect(refundBtn).toBeVisible();

  const refundBox = await refundBtn.boundingBox();
  expect(refundBox?.height).toBeGreaterThanOrEqual(48);

  await refundBtn.click();

  // Expect success message
  await expect(page.getByText(he.purchases.refundSuccess)).toBeVisible();
});

test("Instructor sees no leak on purchases page", async ({ page }) => {
  // Sign in as the instructor whose OWN dance the tickets above were bought
  // for. /profile/purchases shows what the signed-in user bought — never what
  // was sold on their dances — so this must come back empty even though
  // "Purchases flow" left tickets, a punch card and credits attached to this
  // instructor's own occurrences.
  await page.goto("/profile");
  await page.getByLabel(he.signIn.phoneLabel).fill(PHONE_INSTRUCTOR_LOCAL);
  await page.getByRole("button", { name: he.signIn.sendCode }).click();

  const codeField = page.getByLabel(he.signIn.codeLabel);
  await expect(codeField).toBeVisible({ timeout: 20_000 });
  await codeField.fill(TEST_OTP);
  await page.getByRole("button", { name: he.signIn.submitCode, exact: true }).click();

  await expect(page.getByRole("button", { name: he.profileMenu.open })).toBeVisible({ timeout: 20_000 });

  await page.goto("/profile/purchases");

  // No purchases: this instructor never bought anything, whatever was sold on
  // their own dances.
  await expect(page.getByText(he.purchases.noPurchases)).toBeVisible();
});
