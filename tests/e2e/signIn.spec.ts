import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { he } from "../../src/lib/i18n/he";

/**
 * Phone-OTP sign-in, inline on /profile (docs/decisions/0013).
 *
 * Needs the local Supabase stack running (`npm run db:start`). It does NOT need a
 * seeded database — nothing here reads a dance — but it does need this worktree's
 * `supabase/config.toml` to be the one the stack was started with, because the
 * fixed OTP, the captcha and the 60s per-number cooldown all live there.
 *
 * Nothing is stubbed. The whole question these tests answer is "can a dancer with
 * no account get a session", and every part of that — the Turnstile challenge,
 * GoTrue's captcha check, the cookie the session lands in, the server re-render
 * that swaps the screen over — is somebody else's code. A stub would answer by
 * assumption.
 */

/*
 * Serial, overriding the project's `fullyParallel`. These tests share one phone
 * number, and `[auth.sms] max_frequency` is keyed on the number — run in parallel
 * they would trip each other's 60s cooldown and fail for reasons unrelated to
 * what they assert. The per-test reset below only works if nothing else is using
 * the number at the same moment.
 */
test.describe.configure({ mode: "serial" });

/** Ours alone. Sharing a number across suites would share the 60s cooldown. */
const PHONE_E164 = "+972500000004";
const PHONE_LOCAL = "050-0000004";
const TEST_OTP = "123456";

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
  if (typeof fields !== "object" || fields === null) {
    throw new Error("`supabase status -o json` returned something that is not an object");
  }
  const { API_URL, SERVICE_ROLE_KEY } = fields as Record<string, unknown>;
  if (typeof API_URL !== "string" || typeof SERVICE_ROLE_KEY !== "string") {
    throw new Error("`supabase status` did not report API_URL and SERVICE_ROLE_KEY");
  }

  stack = { apiUrl: API_URL, serviceRoleKey: SERVICE_ROLE_KEY };
  return stack;
}

/**
 * Deletes this suite's user, so each run starts from a number that has never
 * asked for a code.
 *
 * Not tidiness — correctness. `[auth.sms] max_frequency` is 60s and GoTrue keys it
 * on the user's last send, test numbers included (verified against this stack), so
 * without this a second run inside a minute would fail on a cooldown that has
 * nothing to do with what is being asserted. Deleting the user resets it.
 */
async function deleteTestUser(): Promise<void> {
  const { apiUrl, serviceRoleKey } = localStack();
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  const listed = await fetch(`${apiUrl}/auth/v1/admin/users?per_page=200`, { headers });
  if (!listed.ok) throw new Error(`could not list auth users: ${listed.status}`);

  const body: unknown = await listed.json();
  const users = (body as { users?: Array<{ id: string; phone?: string }> }).users ?? [];

  for (const user of users) {
    if (user.phone === PHONE_E164.replace("+", "")) {
      const deleted = await fetch(`${apiUrl}/auth/v1/admin/users/${user.id}`, {
        method: "DELETE",
        headers,
      });
      if (!deleted.ok) throw new Error(`could not delete test user: ${deleted.status}`);
    }
  }
}

/**
 * The form's own live region.
 *
 * Targeted by id rather than by role: Next renders its own route announcer with
 * role="alert", so a role query matches two elements and the failure looks like a
 * bug in the app rather than in the query.
 */
function signInError(page: Page) {
  return page.locator("#signin-error");
}

/** What a session with no profile row lands on — see the round-trip test. */
function nameHeading(page: Page) {
  return page.getByRole("heading", { name: he.profileName.heading });
}

/** The heading is the one thing on the page that differs between the two states. */
function signInHeading(page: Page) {
  return page.getByRole("heading", { name: he.signIn.heading });
}

test.beforeEach(async () => {
  await deleteTestUser();
});

test.afterAll(async () => {
  await deleteTestUser();
});

test("/profile is reachable with no session and shows sign-in in place", async ({
  page,
}) => {
  const response = await page.goto("/profile");

  // The regression this exists for is a redirect gate. AGENTS.md §2.2 and
  // docs/decisions/0013: the route must render, at its own URL, for a dancer who
  // followed a link here without knowing an account was involved.
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/profile");

  await expect(page.getByRole("heading", { name: he.profile.heading })).toBeVisible();
  await expect(signInHeading(page)).toBeVisible();
  await expect(page.getByLabel(he.signIn.phoneLabel)).toBeVisible();
});

test("a number that cannot receive an SMS is refused before any code is sent", async ({
  page,
}) => {
  await page.goto("/profile");

  // A Tel Aviv landline: well-formed, real, and a dead end for OTP.
  await page.getByLabel(he.signIn.phoneLabel).fill("03-1234567");
  await page.getByRole("button", { name: he.signIn.sendCode }).click();

  await expect(signInError(page)).toHaveText(he.signIn.errors.invalidPhone);
  // Still on step one — no code was requested, so no SMS could have been spent.
  await expect(page.getByLabel(he.signIn.codeLabel)).toHaveCount(0);
});

test("the full round trip: number, code, signed in, signed out", async ({ page }) => {
  await page.goto("/profile");

  await page.getByLabel(he.signIn.phoneLabel).fill(PHONE_LOCAL);
  await page.getByRole("button", { name: he.signIn.sendCode }).click();

  // Reaching step two proves the Turnstile token was obtained and GoTrue
  // accepted it — the captcha is enforced on /otp, so without a valid token this
  // never advances.
  const codeField = page.getByLabel(he.signIn.codeLabel);
  await expect(codeField).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(he.signIn.codeSentTo(PHONE_E164))).toBeVisible();

  // Focus moved to the new field rather than being left on a button that is gone.
  await expect(codeField).toBeFocused();

  await codeField.fill(TEST_OTP);
  await page.getByRole("button", { name: he.signIn.submitCode, exact: true }).click();

  // What a signed-in visitor sees is now the name step, not the profile:
  // `profiles.display_name` is NOT NULL, so a session with no profile row is
  // asked for a name first (Phase 3.2a). It only renders for a session, so it is
  // as good a proof of one as the old greeting was — and this spec is about
  // getting the session, not about what comes after it.
  await expect(nameHeading(page)).toBeVisible({ timeout: 20_000 });
  await expect(signInHeading(page)).toHaveCount(0);

  // The session is in a cookie, not in component state: a full reload must find
  // it. This is the assertion that would fail if we had settled for localStorage.
  await page.reload();
  await expect(nameHeading(page)).toBeVisible();

  await page.getByRole("button", { name: he.profile.signOut }).click();
  await expect(signInHeading(page)).toBeVisible();
  await page.reload();
  await expect(signInHeading(page)).toBeVisible();
});

test("a bad code is refused, and says so without losing the step", async ({ page }) => {
  await page.goto("/profile");

  await page.getByLabel(he.signIn.phoneLabel).fill(PHONE_LOCAL);
  await page.getByRole("button", { name: he.signIn.sendCode }).click();

  const codeField = page.getByLabel(he.signIn.codeLabel);
  await expect(codeField).toBeVisible({ timeout: 20_000 });

  await codeField.fill("000000");
  await page.getByRole("button", { name: he.signIn.submitCode, exact: true }).click();

  await expect(signInError(page)).toHaveText(he.signIn.errors.badCode);
  // Still on step two with the number intact — a wrong digit must not cost the
  // dancer the code they already received.
  await expect(codeField).toBeVisible();
});

test("keyboard only: tab to the number field, type, and reach the button", async ({
  page,
}) => {
  await page.goto("/profile");

  const focusedId = () => page.evaluate(() => document.activeElement?.id ?? "");

  // Sequential Tab, not .focus() — this asserts the field is genuinely reachable
  // in the tab order, which is what AGENTS.md §2.7 is about. The bound is
  // generous because this runs against `npm run dev`, whose indicator is in the
  // tab order too.
  for (let i = 0; i < 15 && (await focusedId()) !== "signin-phone"; i++) {
    await page.keyboard.press("Tab");
  }
  expect(await focusedId()).toBe("signin-phone");

  await page.keyboard.type(PHONE_LOCAL);
  await expect(page.getByLabel(he.signIn.phoneLabel)).toHaveValue(PHONE_LOCAL);

  // The focused field must have a visible ring — :focus-visible is satisfied by a
  // real Tab, which is why this could not be done with .focus().
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
});

test("every sign-in control clears the 48x48 minimum tap target (AGENTS.md §5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/profile");

  for (const control of await page.locator("form input, form button").all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
});

test("the signed-out form does not scroll sideways at 200% text size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/profile");
  await expect(page.getByLabel(he.signIn.phoneLabel)).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test("the signed-in name step does not scroll sideways at 200% text size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/profile");

  await page.getByLabel(he.signIn.phoneLabel).fill(PHONE_LOCAL);
  await page.getByRole("button", { name: he.signIn.sendCode }).click();
  const codeField = page.getByLabel(he.signIn.codeLabel);
  await expect(codeField).toBeVisible({ timeout: 20_000 });
  await codeField.fill(TEST_OTP);
  await page.getByRole("button", { name: he.signIn.submitCode, exact: true }).click();
  await expect(nameHeading(page)).toBeVisible({ timeout: 20_000 });

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
