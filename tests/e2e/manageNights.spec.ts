import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { he } from "../../src/lib/i18n/he";

/**
 * The browser walk for per-night management (Phase 3.3b).
 *
 * An instructor publishes a weekly series, then cancels one night and moves
 * another to a different hour — and each time, a visitor with NO ACCOUNT is
 * checked in a fresh context. That last part is the point of the whole feature:
 * a change nobody can see is a change that did not happen (AGENTS.md §10).
 *
 * Needs the local Supabase stack (`npm run db:start`) and this worktree's
 * `supabase/config.toml`, which holds the fixed OTP and this suite's number.
 *
 * Serial, with its own number, for the reason docs/decisions/0013 gives:
 * `[auth.sms] max_frequency` is keyed on the phone number.
 */
test.describe.configure({ mode: "serial" });

const PHONE_E164 = "+972500000017";
const PHONE_LOCAL = "050-0000017";
const TEST_OTP = "123456";

const PROFILE_NAME = "אורלי הבודקת";
const PUBLIC_NAME = "אורלי מרקידה";

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
 * Same shape and reason as the other publish specs: `dance_events.instructor_id`
 * is `on delete restrict`, so a user who has published cannot be deleted, the
 * OTP cooldown keyed on them is never reset, and every later test in the file
 * fails at sign-in for a reason unrelated to what it asserts.
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
}

function dateInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Publishes a WEEKLY series, so the manage list has several nights and the
 * generator has slots that a cancelled night has to keep occupying.
 */
async function publishSeries(page: Page): Promise<void> {
  await page.getByLabel(he.publishDance.instructorNameLabel).fill(PUBLIC_NAME);
  await page.getByRole("radio", { name: /היכל התרבות חולון/ }).check();
  await page.getByLabel(he.publishDance.dateLabel).fill(dateInDays(4));
  await page.getByLabel(he.publishDance.startTimeLabel).fill("20:00");
  await page.getByLabel(he.publishDance.endTimeLabel).fill("23:00");
  await page.getByRole("radio", { name: he.publishDance.repeatWeekly, exact: true }).check();
  await page.getByRole("button", { name: he.publishDance.submit }).click();

  await expect(page.locator("#publish-dance-success")).toContainText(/\d+ תאריכים/, {
    timeout: 20_000,
  });
}

/** The manage list, once it has rendered the published series. */
function nightList(page: Page) {
  return page.getByRole("list", { name: he.manageNights.listLabel });
}

async function signedInWithSeries(page: Page): Promise<void> {
  await signIn(page);
  await setName(page);
  await publishSeries(page);
  await expect(nightList(page)).toBeVisible({ timeout: 20_000 });
}

/** Opens the controls for the first night in the list. */
async function openFirstNight(page: Page): Promise<void> {
  await nightList(page)
    .getByRole("button", { name: /^שינוי ההרקדה/ })
    .first()
    .click();
}

test.beforeEach(async () => {
  await resetTestUser();
});

test.afterAll(async () => {
  await resetTestUser();
});

test("a new instructor is told there is nothing to manage yet", async ({ page }) => {
  await signIn(page);
  await setName(page);

  // An empty screen reads as a broken app to this audience (AGENTS.md §2), and
  // there is no instructor row yet — so the section is absent rather than empty.
  await expect(page.getByRole("heading", { name: he.manageNights.heading })).toHaveCount(0);
});

test("publishing a series fills the manage list, one entry per night", async ({ page }) => {
  await signedInWithSeries(page);

  const nights = nightList(page).getByRole("listitem");
  expect(await nights.count()).toBeGreaterThan(1);

  // Each control names its own night rather than saying "שינוי" twelve times.
  const labels = await nightList(page)
    .getByRole("button", { name: /^שינוי ההרקדה/ })
    .allInnerTexts();
  expect(new Set(labels).size).toBe(labels.length);
});

test("cancelling a night takes two deliberate steps, and a dancer is told", async ({
  page,
  browser,
}) => {
  await signedInWithSeries(page);
  await openFirstNight(page);

  // Step one only reveals the confirmation — nothing is written yet.
  await page.getByRole("button", { name: he.manageNights.cancelStart }).click();
  await expect(page.getByRole("button", { name: he.manageNights.cancelConfirm })).toBeVisible();

  await page.getByLabel(he.manageNights.reasonLabel).fill("תקלה במזגן באולם");
  await page.getByRole("button", { name: he.manageNights.cancelConfirm }).click();

  await expect(nightList(page).getByText(he.dance.status.cancelled).first()).toBeVisible({
    timeout: 20_000,
  });

  // The whole point, in a context with no cookies: the night is still THERE and
  // it says "בוטל". A night that vanished would send a dancer who had already
  // made plans to a hall that is dark (AGENTS.md §2.6, §10).
  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto("/schedule");

    await expect(visitor.getByText(PUBLIC_NAME).first()).toBeVisible({ timeout: 20_000 });
    await expect(visitor.getByText(he.dance.status.cancelled).first()).toBeVisible();
  } finally {
    await anonymous.close();
  }
});

test("backing out of a cancellation leaves the night alone", async ({ page }) => {
  await signedInWithSeries(page);
  await openFirstNight(page);

  await page.getByRole("button", { name: he.manageNights.cancelStart }).click();
  await page.getByRole("button", { name: he.manageNights.cancelBack }).click();

  // Back to the controls, and the night is untouched.
  await expect(page.getByRole("button", { name: he.manageNights.cancelStart })).toBeVisible();
  await expect(nightList(page).getByText(he.dance.status.cancelled)).toHaveCount(0);
});

test("moving a night's hour tells a dancer which hour it moved from", async ({
  page,
  browser,
}) => {
  await signedInWithSeries(page);
  await openFirstNight(page);

  // Scoped to the manage list. The publish form above has fields with the same
  // visible labels — they are different controls in different sections, each
  // with its own legend, but an unscoped getByLabel finds the publish form's
  // first and silently "passes" while saving nothing.
  await nightList(page).getByLabel(he.manageNights.startTimeLabel).first().fill("21:30");
  await nightList(page).getByLabel(he.manageNights.endTimeLabel).first().fill("23:30");
  await page.getByRole("button", { name: he.manageNights.saveTime }).click();

  await expect(nightList(page).getByText("21:30").first()).toBeVisible({ timeout: 20_000 });

  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto("/schedule");

    // The new hour AND the old one. The status is still 'scheduled' — 'moved' is
    // reserved for a venue change (docs/decisions/0003) — so this label is the
    // only thing that tells a dancer anything changed.
    await expect(visitor.getByText("21:30").first()).toBeVisible({ timeout: 20_000 });
    await expect(
      visitor.getByText(he.dance.status.retimedFrom("20:00")).first(),
    ).toBeVisible();
  } finally {
    await anonymous.close();
  }
});

test("keyboard only: open a night's controls and reach the cancel step", async ({ page }) => {
  await signedInWithSeries(page);

  const manage = nightList(page)
    .getByRole("button", { name: /^שינוי ההרקדה/ })
    .first();
  await manage.focus();
  await page.keyboard.press("Enter");

  // The disclosure has to announce itself, not just look open (AGENTS.md §2.7).
  await expect(manage).toHaveAttribute("aria-expanded", "true");

  // Sequential Tab from the disclosure, not .focus(): a control reachable only
  // with a mouse passes a programmatic focus test and fails this one.
  const focusedText = () =>
    page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");

  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = (await focusedText()) === he.manageNights.cancelStart;
  }
  expect(reached).toBe(true);

  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThan(0);
});

test("every per-night control clears the 48x48 minimum tap target (AGENTS.md §5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signedInWithSeries(page);
  await openFirstNight(page);
  await page.getByRole("button", { name: he.manageNights.cancelStart }).click();

  const controls = nightList(page).locator("button, input");
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
});

test("the manage list does not scroll sideways at 200% text size", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signedInWithSeries(page);
  await openFirstNight(page);
  await page.getByRole("button", { name: he.manageNights.cancelStart }).click();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
