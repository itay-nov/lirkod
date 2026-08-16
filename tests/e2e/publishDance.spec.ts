import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { he } from "../../src/lib/i18n/he";

/**
 * The browser walk from "signed in with a phone number" to "an anonymous visitor
 * can see the dance" (Phase 3.2a).
 *
 * Needs the local Supabase stack running (`npm run db:start`) and this worktree's
 * `supabase/config.toml`, which holds the fixed OTP and this suite's phone number.
 *
 * Serial, and with its own number, for the reason docs/decisions/0013 gives:
 * `[auth.sms] max_frequency` is keyed on the phone number, so tests sharing one
 * would trip each other's cooldown for reasons unrelated to what they assert.
 */
test.describe.configure({ mode: "serial" });

const PHONE_E164 = "+972500000009";
const PHONE_LOCAL = "050-0000009";
const TEST_OTP = "123456";

const PROFILE_NAME = "רונית הבודקת";
const PUBLIC_NAME = "רונית מרקידה";

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
 * Deletes everything this suite's user published.
 *
 * Not optional tidying — without it the user delete below silently fails. The
 * cascade auth.users → profiles → instructors stops dead at
 * `dance_events.instructor_id`, which is `on delete restrict` (migration 0001,
 * deliberately: removing an instructor would orphan their dances). So a user who
 * has published cannot be removed, the OTP cooldown keyed on that user is never
 * reset, and every later test in the file fails at the sign-in step for a reason
 * that has nothing to do with what it asserts.
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

/**
 * Puts this suite's phone number back to "never seen before".
 *
 * Two jobs at once: it resets the per-number OTP cooldown (keyed on the user
 * row), and it clears the profile/instructor state so the name step and the
 * first-publish name field are actually exercised rather than skipped on a rerun.
 */
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

/** Signs in through the real phone-OTP path — the only way in (AGENTS.md §2.3). */
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
}

/** A date inside the 60-day anon horizon, as the native date input wants it. */
function dateInDays(days: number): string {
  const at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return at.toISOString().slice(0, 10);
}

async function publish(page: Page, date: string): Promise<void> {
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
  await page.getByRole("button", { name: he.publishDance.submit }).click();
}

test.beforeEach(async () => {
  await resetTestUser();
});

test.afterAll(async () => {
  await resetTestUser();
});

test("a signed-in user with no profile is asked for a name, inline and not redirected", async ({
  page,
}) => {
  await signIn(page);

  // The regression this guards is a redirect gate. The route must render, at its
  // own URL, with the name form in place of the profile content.
  await expect(page.getByRole("heading", { name: he.profileName.heading })).toBeVisible({
    timeout: 20_000,
  });
  expect(new URL(page.url()).pathname).toBe("/profile");

  // Nothing to publish with until there is a name.
  await expect(page.getByRole("heading", { name: he.publishDance.heading })).toHaveCount(0);
});

test("naming yourself unlocks the publish form", async ({ page }) => {
  await signIn(page);
  await setName(page);

  await expect(page.getByRole("heading", { name: he.publishDance.heading })).toBeVisible();

  // The public-name field is NOT here any more, and that is the intended change
  // rather than lost coverage. Since Phase 4.2 the role is declared at sign-in
  // (docs/decisions/0018) — `signIn` above ticks "אני מרקיד/ה" — so the instructor
  // row already exists by the time this form renders, and its own name is
  // authoritative. docs/decisions/0004's rule that the private name must never be
  // promoted silently is honoured a step earlier instead: the name step discloses
  // that the name will also be public, which `setName` walks through.
  await expect(page.getByLabel(he.publishDance.instructorNameLabel)).toHaveCount(0);
});

test("the name step says the name will be public when the מרקיד box was ticked", async ({
  page,
}) => {
  // The disclosure that replaces the old first-publish prompt. Without it the
  // step would still promise "לא מוצג לרוקדים אחרים" while quietly publishing
  // that exact name as the מרקיד's public one.
  await signIn(page);

  await expect(page.getByText(he.profileName.introInstructor)).toBeVisible();
  await expect(page.getByText(he.profileName.intro)).toHaveCount(0);
});

test("publishing a dance makes it visible to an anonymous visitor", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await setName(page);

  const date = dateInDays(9);
  await publish(page, date);
  await expect(page.getByText(he.publishDance.published)).toBeVisible({ timeout: 20_000 });

  // A brand-new context with no cookies: the whole point is that a dancer with no
  // account sees this (AGENTS.md §2.2). Reusing `page` would prove nothing.
  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto("/schedule");

    const row = visitor.getByText(PUBLIC_NAME).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
  } finally {
    await anonymous.close();
  }
});

test("the map/schedule filter (Phase 4.6b) narrows to a published dance's real level/type/women-only", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await setName(page);

  // A dance with distinctive, non-default attributes — the whole point is to
  // prove the filter reads what was actually published, not the DEFAULT
  // every other fixture in this suite leaves untouched.
  const date = dateInDays(12);
  const publicName = page.getByLabel(he.publishDance.instructorNameLabel);
  if ((await publicName.count()) > 0) await publicName.fill(PUBLIC_NAME);
  await page.getByRole("radio", { name: /היכל התרבות חולון/ }).check();
  await page.getByLabel(he.publishDance.dateLabel).fill(date);
  await page.getByLabel(he.publishDance.startTimeLabel).fill("20:00");
  await page.getByLabel(he.publishDance.endTimeLabel).fill("23:00");
  await page.getByRole("radio", { name: he.dance.level.advanced }).check();
  await page.getByRole("checkbox", { name: he.dance.formation.circle }).check();
  await page.getByRole("checkbox", { name: he.publishDance.womenOnlyLabel }).check();
  await page.getByRole("button", { name: he.publishDance.submit }).click();
  await expect(page.getByText(he.publishDance.published)).toBeVisible({ timeout: 20_000 });

  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto("/schedule");

    // PROFILE_NAME, not PUBLIC_NAME: since Phase 4.2 the role is declared at
    // sign-in (docs/decisions/0018), so the instructor row already exists by
    // the time this form renders and keeps ITS OWN name — the same reason
    // "naming yourself unlocks the publish form" above asserts the public-name
    // field is absent from this exact flow. supabase/seed.sql reuses "רונית
    // מרקידה" (PUBLIC_NAME) for several unrelated fixture dances, so matching
    // on it here would risk passing against a seeded row instead of the one
    // this test just published; PROFILE_NAME is this test's own, unique name.
    const row = visitor.getByText(PROFILE_NAME).first();
    await expect(row).toBeVisible({ timeout: 20_000 });

    await visitor.getByRole("button", { name: he.filters.toggle }).click();

    // Matches: it IS women_only.
    await visitor.getByRole("checkbox", { name: he.filters.womenOnlyLabel }).check();
    await expect(row).toBeVisible();

    // Narrowed further to a level the dance was NOT published at — the
    // filter's AND-across-axes behaviour (src/lib/domain/danceFilter.ts)
    // means it now has to disappear even though women-only still matches.
    await visitor.getByRole("radio", { name: he.dance.level.beginner }).check();
    await expect(row).not.toBeVisible();

    // Back to "הכול" for level — the dance reappears.
    await visitor.getByRole("radio", { name: he.filters.anyLevel }).check();
    await expect(row).toBeVisible();
  } finally {
    await anonymous.close();
  }
});

test("the public name field disappears once you are already a מרקיד", async ({ page }) => {
  await signIn(page);
  await setName(page);
  await publish(page, dateInDays(10));
  await expect(page.getByText(he.publishDance.published)).toBeVisible({ timeout: 20_000 });

  // The instructor row now exists and its name is authoritative, so asking again
  // would invite two different public names for one person.
  await page.reload();
  await expect(page.getByRole("heading", { name: he.publishDance.heading })).toBeVisible();
  await expect(page.getByLabel(he.publishDance.instructorNameLabel)).toHaveCount(0);
});

test("a dance with no venue chosen is refused, and says which field", async ({ page }) => {
  await signIn(page);
  await setName(page);

  await page.getByLabel(he.publishDance.dateLabel).fill(dateInDays(11));
  await page.getByLabel(he.publishDance.startTimeLabel).fill("20:00");
  await page.getByLabel(he.publishDance.endTimeLabel).fill("23:00");
  await page.getByRole("button", { name: he.publishDance.submit }).click();

  await expect(page.locator("#publish-dance-error")).toHaveText(
    he.publishDance.errors.venueId,
  );
});

test("keyboard only: reach the venue list, the times, and the publish button", async ({
  page,
}) => {
  await signIn(page);
  await setName(page);

  const focusedId = () => page.evaluate(() => document.activeElement?.id ?? "");

  // Sequential Tab, not .focus(): a control that is only reachable with a mouse
  // passes a programmatic focus test and fails this one (AGENTS.md §2.7).
  for (let i = 0; i < 25 && (await focusedId()) !== "venue-search"; i++) {
    await page.keyboard.press("Tab");
  }
  expect(await focusedId()).toBe("venue-search");

  // The radios follow the search box, and arrow keys move between them natively —
  // which is the reason this is a radio group and not a custom combobox.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  expect(await page.getByRole("radio").first().isChecked()).toBe(true);

  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe("none");
});

test("every publish control clears the 48x48 minimum tap target (AGENTS.md §5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await setName(page);

  const controls = page.locator(
    "form input[type=text], form input[type=search], form input[type=date], form input[type=time], form button",
  );
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
});

test("the publish form does not scroll sideways at 200% text size", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await setName(page);
  await expect(page.getByRole("heading", { name: he.publishDance.heading })).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test("the name step does not scroll sideways at 200% text size", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await expect(page.getByLabel(he.profileName.label)).toBeVisible({ timeout: 20_000 });

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
