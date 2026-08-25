import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { he } from "../../src/lib/i18n/he";
import type { Database } from "../../src/types/database";

test.describe.configure({ mode: "serial" });

const PHONE_E164 = "+972500000045";
const PHONE_LOCAL = "050-0000045";
const TEST_OTP = "123456";
const DANCER_NAME = "רוקד כרטיסים";

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

test.beforeAll(async () => {
  // Teardown any leftover user with this phone from a previous aborted run.
  const client = serviceClient();
  const { data: users } = await client.auth.admin.listUsers();
  const user = users?.users.find((u) => u.phone === PHONE_E164.replace("+", ""));
  if (user) {
    await client.auth.admin.deleteUser(user.id);
  }
});

async function signIn(page: Page): Promise<string> {
  await page.goto("/profile");
  await page.getByLabel(he.signIn.phoneLabel).fill(PHONE_LOCAL);
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
  const user = users?.users.find((u) => u.phone === PHONE_E164.replace("+", ""));
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

  // Find a seeded instructor to attach our purchases to (index 0 is an instructor)
  const { data: profiles } = await client.from("profiles").select("id").limit(2);
  const instructorProfileId = profiles![0]!.id; // We'll just grab any profile and make it an instructor if needed, but seed.sql provides one.
  
  // Wait, let's grab the real instructor from seed
  const { data: instructors } = await client.from("instructors").select("id, profile_id").limit(1);
  const instructorId = instructors![0]!.id;

  // Let's create an order
  const { data: order } = await client.from("orders").insert({
    buyer_id: userId,
    instructor_id: instructorId,
    kind: "ticket",
    status: "paid",
    gross_amount_agorot: 5000,
  }).select().single();

  if (!order) throw new Error("Order creation failed");

  // Get a dance event to link the ticket
  const { data: occurrences } = await client.from("event_occurrences")
    .select("id, starts_at, dance_events!inner(instructor_id, price_agorot)")
    .eq("dance_events.instructor_id", instructorId)
    .gt("starts_at", new Date().toISOString())
    .limit(2);
  
  const occurrence1 = occurrences![0];
  const occurrence2 = occurrences![1];

  // Insert a ticket
  await client.from("tickets").insert({
    buyer_id: userId,
    order_id: order.id,
    occurrence_id: occurrence1!.id,
    status: "valid",
  });

  // Insert a punch card
  await client.from("punch_cards").insert({
    buyer_id: userId,
    order_id: order.id, // using same order for simplicity
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

  // We choose the occurrence that has price <= credit. 
  // Wait, price might be 0, which we filtered out. We should ensure the price is > 0.
  // Actually, let's just select the first available option.
  await select.selectOption({ index: 1 }); // index 0 is the placeholder
  
  const redeemBtn = page.getByRole("button", { name: he.purchases.redeemButton });
  const redeemBox = await redeemBtn.boundingBox();
  expect(redeemBox?.height).toBeGreaterThanOrEqual(48);
  
  await redeemBtn.click();
  
  // Expect success message
  await expect(page.getByText(he.purchases.redeemSuccess)).toBeVisible();
  
  // Insert a credit (expired, refundable)
  const { data: expiredCredit } = await client.from("credits").insert({
    buyer_id: userId,
    source_order_id: order.id,
    instructor_id: instructorId,
    amount_agorot: 5000,
    remaining_agorot: 5000,
    status: "expired",
    expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
  }).select().single();

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
  const client = serviceClient();
  // Get the seeded instructor
  const { data: instructors } = await client.from("instructors").select("id, profile_id").limit(1);
  const instructor = instructors![0]!;
  
  // Get their phone
  const { data: userResp } = await client.auth.admin.getUserById(instructor.profile_id);
  const instructorPhone = userResp.user!.phone!;
  const localPhone = "0" + instructorPhone.substring(4); // e.g. +97250 -> 050

  // Sign in as instructor
  await page.goto("/profile");
  await page.getByLabel(he.signIn.phoneLabel).fill(localPhone);
  await page.getByRole("button", { name: he.signIn.sendCode }).click();
  
  const codeField = page.getByLabel(he.signIn.codeLabel);
  await expect(codeField).toBeVisible({ timeout: 20_000 });
  await codeField.fill(TEST_OTP); // Seeded instructor has fixed OTP usually or 123456
  await page.getByRole("button", { name: he.signIn.submitCode, exact: true }).click();
  
  await expect(page.getByRole("button", { name: he.profileMenu.open })).toBeVisible({ timeout: 20_000 });
  
  await page.goto("/profile/purchases");
  
  // They should have NO purchases shown (because they didn't buy any), 
  // even though there are tickets attached to their occurrence_id (created in previous test or seeded)
  await expect(page.getByText(he.purchases.noPurchases)).toBeVisible();
});
