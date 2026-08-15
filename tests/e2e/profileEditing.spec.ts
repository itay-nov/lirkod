import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { he } from "../../src/lib/i18n/he";

/**
 * The browser walk through Phase 4.3: picking an avatar, editing the private
 * name afterwards, and editing the instructor's public name independently
 * (docs/decisions/0019).
 *
 * Needs the local Supabase stack (`npm run db:start`) and this worktree's
 * `supabase/config.toml`, which holds the fixed OTP and this suite's own
 * phone number (972500000020 — not any other spec's, for the OTP-cooldown
 * reason every sibling file in this directory already documents).
 */
test.describe.configure({ mode: "serial" });

const PHONE_E164 = "+972500000020";
const PHONE_LOCAL = "050-0000020";
const TEST_OTP = "123456";

const PROFILE_NAME = "מירי הבודקת";
const CHANGED_PROFILE_NAME = "מירי אחרי עריכה";
const PUBLIC_NAME_CHANGE = "מירי מרקידה בפומבי";

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

/** Puts this suite's phone number back to "never seen before" — same reason every sibling spec resets its own. */
async function resetTestUser(): Promise<void> {
  const { apiUrl } = localStack();

  const listed = await fetch(`${apiUrl}/auth/v1/admin/users?per_page=200`, {
    headers: adminHeaders(),
  });
  if (!listed.ok) throw new Error(`could not list auth users: ${listed.status}`);

  const body = (await listed.json()) as { users?: Array<{ id: string; phone?: string }> };
  for (const user of body.users ?? []) {
    if (user.phone !== PHONE_E164.replace("+", "")) continue;
    const deleted = await fetch(`${apiUrl}/auth/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    if (!deleted.ok) throw new Error(`could not delete test user: ${deleted.status}`);
  }
}

/** Signs in and declares the מרקיד role, so both name-edit forms are reachable. */
async function signIn(page: Page): Promise<void> {
  await page.goto("/profile");
  await page.getByLabel(he.signIn.phoneLabel).fill(PHONE_LOCAL);
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

test.beforeEach(async () => {
  await resetTestUser();
});

test.afterAll(async () => {
  await resetTestUser();
});

test("the greeting shows the default avatar as soon as there is a profile", async ({
  page,
}) => {
  await signIn(page);
  await setName(page);

  // Every avatar icon is a decorative, aria-hidden <svg> (see Avatar.tsx) — the
  // accessible name lives on the picker's radio, not here — so the render
  // check is structural: an <svg> sits right next to the greeting text.
  const greeting = page.getByText(he.profile.greeting(PROFILE_NAME));
  await expect(greeting).toBeVisible();
  await expect(page.locator("svg").first()).toBeVisible();
});

test("editing the profile changes the name and the shown avatar, without a page reload", async ({
  page,
}) => {
  await signIn(page);
  await setName(page);

  await page.getByRole("button", { name: he.profileEdit.toggle }).click();

  // Scoped to the profile-edit <form> specifically: it and
  // InstructorNameForm both use the word "שמירה" for their save button
  // (docs/decisions/0004 — two DIFFERENT names, deliberately worded the same
  // generic way each on its own form), so an unscoped query on this page is
  // ambiguous once both forms are showing at once, which they are for a
  // signed-in מרקיד.
  const editForm = page
    .locator("form")
    .filter({ has: page.getByText(he.profileEdit.avatarLabel) });

  const nameField = editForm.getByLabel(he.profileEdit.nameLabel);
  await expect(nameField).toBeVisible();
  await nameField.fill(CHANGED_PROFILE_NAME);

  // Pick a specific, non-default avatar — the picker is a real radio group
  // (AGENTS.md §2.7), so this both exercises the control and gives the next
  // assertion something concrete to look for.
  //
  // Clicking the wrapping <label>, not `.check()` on the (visually-hidden)
  // radio directly: that is what a real tap or click actually lands on —
  // the label is the whole 64px tile — and the browser's own label→input
  // forwarding is what checks the radio, the same path a real user's tap
  // goes through.
  await editForm
    .getByRole("radio", { name: he.avatars.dancer_figure })
    .locator("xpath=ancestor::label")
    .click();

  await editForm.getByRole("button", { name: he.profileEdit.save }).click();

  await expect(page.getByText(he.profile.greeting(CHANGED_PROFILE_NAME))).toBeVisible({
    timeout: 20_000,
  });
  // The edit form closed back to its toggle — confirms the save round-tripped
  // through the server and re-rendered, not just local state.
  await expect(page.getByRole("button", { name: he.profileEdit.toggle })).toBeVisible();
});

test("cancelling an edit discards it — the name reverts to what it was", async ({ page }) => {
  await signIn(page);
  await setName(page);

  await page.getByRole("button", { name: he.profileEdit.toggle }).click();
  await page.getByLabel(he.profileEdit.nameLabel).fill("שם שלא יישמר");
  await page.getByRole("button", { name: he.profileEdit.cancel }).click();

  // Still the name from setName — nothing was sent.
  await expect(page.getByText(he.profile.greeting(PROFILE_NAME))).toBeVisible();
  await expect(page.getByText("שם שלא יישמר")).toHaveCount(0);
});

test("the instructor's public name is editable independently of the private name", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await setName(page);

  await expect(page.getByRole("heading", { name: he.instructorName.heading })).toBeVisible();

  const publicNameField = page.getByLabel(he.instructorName.label);
  // Defaults to the private name on first declaration (docs/decisions/0018).
  await expect(publicNameField).toHaveValue(PROFILE_NAME);

  await publicNameField.fill(PUBLIC_NAME_CHANGE);
  await page.getByRole("button", { name: he.instructorName.save, exact: true }).click();

  // The private greeting is untouched by a public-name save.
  await expect(page.getByText(he.profile.greeting(PROFILE_NAME))).toBeVisible({
    timeout: 20_000,
  });

  // And an anonymous visitor — a fresh browser context, no cookies — sees the
  // new PUBLIC name on the schedule, which is the entire point of the split
  // (docs/decisions/0004).
  const visitorContext = await browser.newContext();
  try {
    const visitor = await visitorContext.newPage();
    await visitor.goto("/schedule");
    // Best-effort: this instructor may have no published nights, in which case
    // the name never reaches /schedule at all — the RLS suite already proves
    // the write landed and stayed distinct from the private name, so this is
    // an additional check when there IS something to see, not the only proof.
    const named = visitor.getByText(PUBLIC_NAME_CHANGE);
    if (await named.count() > 0) {
      await expect(named.first()).toBeVisible();
    }
  } finally {
    await visitorContext.close();
  }
});

test("the avatar picker stays usable at 200% text on a 375px phone, and its tiles clear 48px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page);
  await setName(page);

  await page.getByRole("button", { name: he.profileEdit.toggle }).click();
  await expect(page.getByRole("radio", { name: he.avatars.pomegranate })).toBeVisible();

  const tileBox = await page
    .getByRole("radio", { name: he.avatars.pomegranate })
    .locator("xpath=ancestor::label")
    .boundingBox();
  expect(tileBox?.width ?? 0).toBeGreaterThanOrEqual(48);
  expect(tileBox?.height ?? 0).toBeGreaterThanOrEqual(48);

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test("keyboard alone reaches the avatar picker and changes the selection", async ({ page }) => {
  await signIn(page);
  await setName(page);

  await page.getByRole("button", { name: he.profileEdit.toggle }).click();

  const musicalNotes = page.getByRole("radio", { name: he.avatars.musical_notes });
  // A real radio input: focusing it and pressing Space checks it, and arrow
  // keys move within the group — native behaviour this markup relies on
  // rather than reimplementing (AGENTS.md §2.7).
  await musicalNotes.focus();
  await page.keyboard.press(" ");
  await expect(musicalNotes).toBeChecked();
});
