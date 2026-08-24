import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { he } from "../../src/lib/i18n/he";

/**
 * The browser walk for a dance that REPEATS (Phase 3.3a).
 *
 * publishDance.spec.ts already covers the single-night path, the name step, the
 * tap targets and the 200% text-size check on this form; none of that is
 * repeated. What is asserted here is only what the repeat control adds: choosing
 * it produces a series rather than one night, the weekday is stated rather than
 * asked for, the end date appears only when it means something, and the whole
 * thing arrives at a visitor with no account.
 *
 * Needs the local Supabase stack (`npm run db:start`) and this worktree's
 * `supabase/config.toml`, which holds the fixed OTP and this suite's number.
 *
 * Serial, with its own number, for the reason docs/decisions/0013 gives:
 * `[auth.sms] max_frequency` is keyed on the phone number.
 */
test.describe.configure({ mode: "serial" });

const PHONE_E164 = "+972500000014";
const PHONE_LOCAL = "050-0000014";
const TEST_OTP = "123456";

const PROFILE_NAME = "נורית הבודקת";
const PUBLIC_NAME = "נורית מרקידה";

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
  } catch (cause) {
    throw new Error(
      "Could not read the local Supabase stack. Start it with: npm run db:start",
      { cause },
    );
  }

  const fields: unknown = JSON.parse(raw);
  const { API_URL, SERVICE_ROLE_KEY } = fields as Record<string, unknown>;
  if (typeof API_URL !== "string" || typeof SERVICE_ROLE_KEY !== "string") {
    throw new Error("`supabase status` did not report API_URL and SERVICE_ROLE_KEY");
  }

  stack = { apiUrl: API_URL, serviceRoleKey: SERVICE_ROLE_KEY };
  return stack;
}

function adminHeaders(): Record<string, string> {
  const { serviceRoleKey } = localStack();
  return { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
}

async function rest(path: string, init?: RequestInit): Promise<Response> {
  const { apiUrl } = localStack();
  return fetch(`${apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...adminHeaders(), "Content-Type": "application/json", ...init?.headers },
  });
}

/**
 * Same shape and same reason as publishDance.spec.ts: `dance_events.instructor_id`
 * is `on delete restrict`, so a user who has published cannot be deleted, the OTP
 * cooldown keyed on them is never reset, and every later test in the file fails at
 * sign-in for a reason unrelated to what it asserts.
 */
async function deletePublishedDances(profileId: string): Promise<void> {
  const instructors = (await (
    await rest(`instructors?select=id&profile_id=eq.${profileId}`)
  ).json()) as Array<{ id: string }>;

  for (const instructor of instructors) {
    const events = (await (
      await rest(`dance_events?select=id&instructor_id=eq.${instructor.id}`)
    ).json()) as Array<{ id: string }>;

    for (const event of events) {
      await rest(`event_occurrences?event_id=eq.${event.id}`, { method: "DELETE" });
      await rest(`dance_events?id=eq.${event.id}`, { method: "DELETE" });
    }
  }
}

async function resetTestUser(): Promise<void> {
  const { apiUrl } = localStack();

  const listed = await fetch(`${apiUrl}/auth/v1/admin/users?per_page=200`, {
    headers: adminHeaders(),
  });
  if (!listed.ok) throw new Error(`could not list auth users: ${listed.status}`);

  const body = (await listed.json()) as { users?: Array<{ id: string; phone?: string }> };
  for (const user of body.users ?? []) {
    if (user.phone !== PHONE_E164.replace("+", "")) continue;

    await deletePublishedDances(user.id);

    const deleted = await fetch(`${apiUrl}/auth/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    if (!deleted.ok) throw new Error(`could not delete test user: ${deleted.status}`);
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/profile");
  await page.getByLabel(he.signIn.phoneLabel).fill(PHONE_LOCAL);
  // Declares the מרקיד role on the way in (Phase 4.2, docs/decisions/0018).
  // Every test in this file publishes or manages a dance, and those surfaces are
  // now offered to instructors only — so this box IS the flow under test, not
  // setup around it. Before 4.2 the role was a side effect of publishing, which
  // is why these helpers used not to need it.
  await page.getByLabel(he.signIn.instructorLabel).check();
  await page.getByRole("button", { name: he.signIn.sendCode }).click();

  const codeField = page.getByLabel(he.signIn.codeLabel);
  await expect(codeField).toBeVisible({ timeout: 20_000 });
  await codeField.fill(TEST_OTP);
  await page.getByRole("button", { name: he.signIn.submitCode, exact: true }).click();
}

async function setName(page: Page): Promise<void> {
  const nameField = page.getByLabel(he.profileName.label);
  await expect(nameField).toBeVisible({ timeout: 20_000 });
  await nameField.fill(PROFILE_NAME);
  await page.getByRole("button", { name: he.profileName.save }).click();
  await expect(page.getByText(he.profile.greeting(PROFILE_NAME))).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("link", { name: he.profileMenu.createDance }).click();
  await expect(page).toHaveURL(/\/profile\/create-dance$/);
  await expect(page.getByRole("heading", { name: he.profileMenu.createDance })).toBeVisible();
}

/** A date `days` out, as the native date input wants it. */
function dateInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fillDance(page: Page, date: string): Promise<void> {
  // Only when the form actually asks. Since Phase 4.2 the role is declared at
  // sign-in (docs/decisions/0018), so an instructor row usually exists by now and
  // its own name is authoritative — the field is absent in that case. It still
  // renders for anyone who became an instructor some other way, and this helper
  // has to work for both.
  const publicName = page.getByLabel(he.publishDance.instructorNameLabel);
  if ((await publicName.count()) > 0) await publicName.fill(PUBLIC_NAME);
  await page.getByRole("radio", { name: /היכל התרבות חולון/ }).check();
  await page.getByLabel(he.publishDance.dateLabel).fill(date);
  await page.getByLabel(he.publishDance.startTimeLabel).fill("20:00");
  await page.getByLabel(he.publishDance.endTimeLabel).fill("23:00");
}

test.beforeEach(async () => {
  await resetTestUser();
});

test.afterAll(async () => {
  await resetTestUser();
});

test("the repeat choice defaults to a single night, with no end date to fill in", async ({
  page,
}) => {
  await signIn(page);
  await setName(page);

  // Nothing about the form changes for someone publishing one night, which is
  // still the common case — the recurring fields must not arrive uninvited.
  await expect(page.getByRole("radio", { name: he.publishDance.repeatOnce, exact: true })).toBeChecked();
  await expect(page.getByLabel(he.publishDance.untilDateLabel)).toHaveCount(0);
});

test("choosing a repeat names the weekday instead of asking for it", async ({ page }) => {
  await signIn(page);
  await setName(page);

  // A Sunday, chosen so the expected weekday is fixed rather than derived from
  // the same code path the assertion is checking.
  await page.getByLabel(he.publishDance.dateLabel).fill("2026-09-06");
  await page.getByRole("radio", { name: he.publishDance.repeatWeekly, exact: true }).check();

  await expect(page.getByText(he.publishDance.repeatHint("יום ראשון"))).toBeVisible();
  // And the end date turns up now that it means something.
  await expect(page.getByLabel(he.publishDance.untilDateLabel)).toBeVisible();
});

test("publishing a weekly dance creates a whole series a visitor can see", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await setName(page);

  await fillDance(page, dateInDays(4));
  await page.getByRole("radio", { name: he.publishDance.repeatWeekly, exact: true }).check();
  await page.getByRole("button", { name: he.publishDance.submit }).click();

  // The number of nights is what tells the instructor the repeat took effect, so
  // it is what the success message is asserted on.
  await expect(page.locator("#publish-dance-success")).toContainText(/\d+ תאריכים/, {
    timeout: 20_000,
  });

  // A brand-new context with no cookies: generated nights have to reach a dancer
  // with no account, the same as a hand-published one (AGENTS.md §2.2).
  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto("/schedule");

    // More than one night on the schedule under this instructor's name is the
    // whole difference between a series and a single dance.
    //
    // PROFILE_NAME, not PUBLIC_NAME: since Phase 4.2 the role is declared at
    // sign-in, and the instructor row is created there from the profile name —
    // so that is the name a visitor sees. The name step discloses this before
    // it happens (`profileName.introInstructor`); docs/decisions/0018 records
    // the trade-off, and letting an instructor edit their public name
    // afterwards is noted there as follow-up.
    await expect(visitor.getByText(PROFILE_NAME).first()).toBeVisible({ timeout: 20_000 });
    expect(await visitor.getByText(PROFILE_NAME).count()).toBeGreaterThan(1);
  } finally {
    await anonymous.close();
  }
});

test("an end date before the start date is refused, and says which field", async ({
  page,
}) => {
  await signIn(page);
  await setName(page);

  await fillDance(page, dateInDays(20));
  await page.getByRole("radio", { name: he.publishDance.repeatBiweekly, exact: true }).check();
  await page.getByLabel(he.publishDance.untilDateLabel).fill(dateInDays(5));
  await page.getByRole("button", { name: he.publishDance.submit }).click();

  await expect(page.locator("#publish-dance-error")).toHaveText(
    he.publishDance.errors.untilDate,
  );
});

test("every repeat control clears the 48x48 minimum tap target (AGENTS.md §5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await setName(page);

  await page.getByLabel(he.publishDance.dateLabel).fill(dateInDays(6));
  await page.getByRole("radio", { name: he.publishDance.repeatWeekly, exact: true }).check();

  // The label is the tap target, not the 24px radio inside it — a control this
  // audience has to hit with a thumb.
  for (const option of [
    he.publishDance.repeatOnce,
    he.publishDance.repeatWeekly,
    he.publishDance.repeatBiweekly,
  ]) {
    const box = await page.getByText(option, { exact: true }).locator("..").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }

  const untilBox = await page.getByLabel(he.publishDance.untilDateLabel).boundingBox();
  expect(untilBox?.height ?? 0).toBeGreaterThanOrEqual(48);
});

test("the recurring fields do not scroll sideways at 200% text size", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await setName(page);

  await page.getByLabel(he.publishDance.dateLabel).fill(dateInDays(7));
  await page.getByRole("radio", { name: he.publishDance.repeatBiweekly, exact: true }).check();
  await expect(page.getByLabel(he.publishDance.untilDateLabel)).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
