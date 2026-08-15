import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { he } from "../../src/lib/i18n/he";

/**
 * The browser walk through Phase 4.5's heart toggle: a guest meets the
 * sign-in prompt instead of an error, a signed-in dancer favorites a dance
 * on the schedule and finds it in "My Favorites", and un-favoriting there
 * removes it.
 *
 * Needs the local Supabase stack (`npm run db:start`, then `npm run db:reset`
 * so `supabase/seed.sql`'s dances exist to favorite — the same requirement
 * `tests/db/proximity.test.ts` documents) and this worktree's
 * `supabase/config.toml`, with this suite's own phone number
 * (972500000023 — not any other spec's, for the OTP-cooldown reason every
 * sibling file in this directory already documents).
 */
test.describe.configure({ mode: "serial" });

const PHONE_E164 = "+972500000023";
const PHONE_LOCAL = "050-0000023";
const TEST_OTP = "123456";
const DANCER_NAME = "דנה הבודקת";

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

/** Puts this suite's phone number back to "never seen before", and clears any favorites it left. */
async function resetTestUser(): Promise<void> {
  const { apiUrl } = localStack();

  const listed = await fetch(`${apiUrl}/auth/v1/admin/users?per_page=200`, {
    headers: adminHeaders(),
  });
  if (!listed.ok) throw new Error(`could not list auth users: ${listed.status}`);

  const body = (await listed.json()) as { users?: Array<{ id: string; phone?: string }> };
  for (const user of body.users ?? []) {
    if (user.phone !== PHONE_E164.replace("+", "")) continue;
    // Deleting the auth user cascades to profiles, and favorites cascades
    // from auth.users directly (migration 0012) — nothing extra to clean.
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

  const nameField = page.getByLabel(he.profileName.label);
  await expect(nameField).toBeVisible({ timeout: 20_000 });
  await nameField.fill(DANCER_NAME);
  await page.getByRole("button", { name: he.profileName.save }).click();
  await expect(page.getByText(he.profile.greeting(DANCER_NAME))).toBeVisible({
    timeout: 20_000,
  });
}

/** Any heart that currently offers to ADD a favorite — the accessible name always names a venue after the colon. */
function unfavoritedHearts(page: Page) {
  return page.getByRole("button", { name: /^הוספה למועדפים: / });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The heart for a SPECIFIC dance, matching either its "add" or "remove"
 * label — `.first()`, deliberately: favoriting acts on the SERIES, not one
 * night (docs/decisions/0002, 0020), and the seeded dance this suite favorites
 * is a recurring one, so several upcoming occurrences share both this venue
 * name and one `eventId`. Every heart among them toggles together, by design
 * — `.first()` is "any one of them", not "the specific one clicked".
 *
 * `unfavoritedHearts(page).first()` is what a real dancer taps first, but is
 * the wrong thing to keep polling afterward: the moment that heart favorites,
 * its accessible name switches from "הוספה" to "הסרה", so it drops out of
 * `unfavoritedHearts` and `.first()` re-resolves to a DIFFERENT, still-
 * unfavorited occurrence of the same series on the next poll — a false
 * failure in the test, not a bug in the feature (confirmed by hand against
 * the same dev server before writing this). This locator stays pinned to the
 * dance regardless of which way its hearts currently point.
 */
function heartFor(page: Page, venue: string) {
  return page
    .getByRole("button", {
      // "add" and "remove" use different prepositions in Hebrew — he.favorites.add
      // is "...ל..." (TO the favorites) and he.favorites.remove is "...מה..."
      // (FROM the favorites) — matched as two whole alternatives rather than
      // trying to share one prefix across both.
      name: new RegExp(
        `^(הוספה למועדפים|הסרה מהמועדפים): ${escapeRegExp(venue)}$`,
      ),
    })
    .first();
}

test.beforeEach(async () => {
  await resetTestUser();
});

test.afterAll(async () => {
  await resetTestUser();
});

test("a guest tapping a heart on the schedule sees the sign-in prompt, never an error (AGENTS.md §2.2)", async ({
  page,
}) => {
  await page.goto("/schedule");

  const heart = unfavoritedHearts(page).first();
  await expect(heart).toBeVisible({ timeout: 20_000 });
  await expect(heart).toBeEnabled({ timeout: 20_000 });

  await heart.click();

  await expect(page.getByText(he.favorites.signedOutEmpty).first()).toBeVisible();
  // The tap did not favorite anything — the heart is still offering to add.
  await expect(heart).toHaveAttribute("aria-pressed", "false");
});

test("a signed-in dancer favorites a dance on the schedule, and it shows up in My Favorites", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/schedule");

  const firstUnfavorited = unfavoritedHearts(page).first();
  await expect(firstUnfavorited).toBeVisible({ timeout: 20_000 });
  await expect(firstUnfavorited).toBeEnabled({ timeout: 20_000 });

  const venue = (await firstUnfavorited.getAttribute("aria-label"))!.replace(
    /^הוספה למועדפים: /,
    "",
  );
  const heart = heartFor(page, venue);

  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true", { timeout: 20_000 });

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: he.favorites.heading })).toBeVisible();
  await expect(page.getByRole("list", { name: he.favorites.listLabel })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(he.favorites.empty)).toHaveCount(0);

  // Un-favoriting from the list itself removes it, and the dignified empty
  // state comes back — the real list, not the Phase 4.5 placeholder.
  const removeButton = page.getByRole("button", { name: /^הסרה מהמועדפים: / });
  await removeButton.first().click();
  await expect(page.getByText(he.favorites.empty)).toBeVisible({ timeout: 20_000 });
});
