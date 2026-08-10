import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { he } from "../../src/lib/i18n/he";

/**
 * Adding a hall from Google Places and publishing a dance there (Phase 3.2b).
 *
 * Needs the local Supabase stack, this worktree's `supabase/config.toml`, and a
 * working `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` with Places API (NEW) enabled and a
 * referrer allowlist covering the port this runs on.
 *
 * It drives the REAL Places API rather than a stub, for the reason map.spec.ts
 * gives about the Maps library: the question this file answers — can an
 * instructor find a hall that is not in our table and end up with a dance a
 * dancer can see — is a question about Google's behaviour and our handling of
 * it, and a stub would answer it by assumption. The cost is a handful of
 * billable autocomplete sessions per run and a dependency on Google being up.
 *
 * Nothing here asserts on a specific place. Google's results change; the test
 * takes whatever the first suggestion is and follows it through.
 */
test.describe.configure({ mode: "serial" });

const PHONE_E164 = "+972500000011";
const PHONE_LOCAL = "050-0000011";
const TEST_OTP = "123456";
const PROFILE_NAME = "בודקת מקומות";

/** Broad enough that Israel-restricted Places always has something to say. */
const PLACE_QUERY = "היכל התרבות";

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
    throw new Error("Could not read the local stack. Start it with: npm run db:start", {
      cause,
    });
  }
  const { API_URL, SERVICE_ROLE_KEY } = JSON.parse(raw) as Record<string, unknown>;
  if (typeof API_URL !== "string" || typeof SERVICE_ROLE_KEY !== "string") {
    throw new Error("`supabase status` did not report API_URL and SERVICE_ROLE_KEY");
  }
  stack = { apiUrl: API_URL, serviceRoleKey: SERVICE_ROLE_KEY };
  return stack;
}

function headers(): Record<string, string> {
  const { serviceRoleKey } = localStack();
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };
}

const rest = (path: string, init?: RequestInit) =>
  fetch(`${localStack().apiUrl}/rest/v1/${path}`, { ...init, headers: headers() });

/**
 * Place ids present before the run. Anything else this suite created is a real
 * Google place it added to the developer's database, and afterAll removes
 * exactly those — a prefix sweep cannot work here, because the names come from
 * Google rather than from us.
 */
let placeIdsBefore = new Set<string>();

async function currentPlaceIds(): Promise<Set<string>> {
  const rows = (await (await rest("venues?select=place_id")).json()) as Array<{
    place_id: string | null;
  }>;
  return new Set(rows.map((row) => row.place_id).filter((id): id is string => id !== null));
}

async function removeVenuesAddedByThisRun(): Promise<void> {
  const rows = (await (await rest("venues?select=id,place_id")).json()) as Array<{
    id: string;
    place_id: string | null;
  }>;

  for (const row of rows) {
    if (row.place_id === null || placeIdsBefore.has(row.place_id)) continue;

    const events = (await (
      await rest(`dance_events?select=id&venue_id=eq.${row.id}`)
    ).json()) as Array<{ id: string }>;
    for (const event of events) {
      await rest(`event_occurrences?event_id=eq.${event.id}`, { method: "DELETE" });
      await rest(`dance_events?id=eq.${event.id}`, { method: "DELETE" });
    }
    await rest(`venues?id=eq.${row.id}`, { method: "DELETE" });
  }
}

/** Also resets the per-number OTP cooldown, which is keyed on the user row. */
async function resetTestUser(): Promise<void> {
  const { apiUrl } = localStack();
  const listed = await fetch(`${apiUrl}/auth/v1/admin/users?per_page=200`, {
    headers: headers(),
  });
  const body = (await listed.json()) as { users?: Array<{ id: string; phone?: string }> };

  for (const user of body.users ?? []) {
    if (user.phone !== PHONE_E164.replace("+", "")) continue;

    // dance_events.instructor_id is `on delete restrict`, so a publisher cannot
    // be deleted until their dances are gone — and a surviving user keeps the
    // cooldown that fails the next sign-in.
    const instructors = (await (
      await rest(`instructors?select=id&profile_id=eq.${user.id}`)
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
    await fetch(`${apiUrl}/auth/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: headers(),
    });
  }
}

async function signInAndName(page: Page): Promise<void> {
  await page.goto("/profile");
  await page.getByLabel(he.signIn.phoneLabel).fill(PHONE_LOCAL);
  await page.getByRole("button", { name: he.signIn.sendCode }).click();

  const code = page.getByLabel(he.signIn.codeLabel);
  await expect(code).toBeVisible({ timeout: 20_000 });
  await code.fill(TEST_OTP);
  await page.getByRole("button", { name: he.signIn.submitCode, exact: true }).click();

  const name = page.getByLabel(he.profileName.label);
  await expect(name).toBeVisible({ timeout: 20_000 });
  await name.fill(PROFILE_NAME);
  await page.getByRole("button", { name: he.profileName.save }).click();
  await expect(page.getByRole("heading", { name: he.publishDance.heading })).toBeVisible({
    timeout: 20_000,
  });
}

function dateInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test.beforeAll(async () => {
  placeIdsBefore = await currentPlaceIds();
});

test.beforeEach(async () => {
  await resetTestUser();
});

test.afterAll(async () => {
  await resetTestUser();
  await removeVenuesAddedByThisRun();
});

test("the venue list is searched on the server, not filtered in the browser", async ({
  page,
}) => {
  const searches: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/venues/search")) searches.push(request.url());
  });

  await signInAndName(page);
  await page.getByLabel(he.publishDance.venueSearchLabel).fill("חולון");

  // The regression this guards is a silent return to client-side filtering: with
  // venues self-service the browser must never be shipped the whole table.
  //
  // Polled on the SPECIFIC query rather than on "any request happened". The
  // picker also fetches once on mount with an empty q, so a poll for the first
  // request is satisfied before the debounced search for "חולון" has fired —
  // which passes alone and fails under load, the worst kind of green.
  await expect
    .poll(() => searches.filter((url) => url.includes(encodeURIComponent("חולון"))).length, {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);

  await expect(page.getByRole("radio", { name: /חולון/ })).toBeVisible();
});

test("a search that matches nothing says so rather than showing every hall", async ({
  page,
}) => {
  await signInAndName(page);
  await page.getByLabel(he.publishDance.venueSearchLabel).fill("זזזזזזזז");

  await expect(page.getByText(he.publishDance.venueEmpty)).toBeVisible({ timeout: 10_000 });
  expect(await page.getByRole("radio").count()).toBe(0);
});

test("adds a hall from Google Places, publishes there, and a dancer with no account sees it", async ({
  page,
  browser,
}) => {
  await signInAndName(page);

  await page.getByRole("button", { name: he.publishDance.addVenueToggle }).click();
  const placeField = page.getByLabel(he.publishDance.addVenueSearchLabel);
  await expect(placeField).toBeVisible();
  // Focus moves to the field, so a keyboard user is not left where the button was.
  await expect(placeField).toBeFocused();

  await placeField.fill(PLACE_QUERY);

  // Real Places, so the wait is generous and nothing asserts on which hall comes
  // back — only that Google answered and we rendered it as a real control.
  const suggestions = page.getByRole("list", {
    name: he.publishDance.addVenueSuggestionsLabel,
  });
  await expect(suggestions).toBeVisible({ timeout: 25_000 });
  const first = suggestions.getByRole("button").first();
  const suggestionText = (await first.innerText()).trim();
  expect(suggestionText.length).toBeGreaterThan(0);

  await first.click();

  // Back on the picker, with the new hall selected — the instructor added it in
  // order to use it, so it must not need finding again.
  const chosen = page.getByRole("radio", { checked: true });
  await expect(chosen).toBeVisible({ timeout: 25_000 });
  const venueName = (await chosen.locator("xpath=../span/span[1]").innerText()).trim();
  expect(venueName.length).toBeGreaterThan(0);

  const date = dateInDays(9);
  await page.getByLabel(he.publishDance.dateLabel).fill(date);
  await page.getByLabel(he.publishDance.startTimeLabel).fill("20:00");
  await page.getByLabel(he.publishDance.endTimeLabel).fill("23:00");
  await page.getByRole("button", { name: he.publishDance.submit }).click();
  await expect(page.getByText(he.publishDance.published)).toBeVisible({ timeout: 25_000 });

  // A context with no cookies at all: the whole claim of the feature is that a
  // hall an instructor added reaches someone with no account (AGENTS.md §2.2).
  const anonymous = await browser.newContext();
  try {
    const visitor = await anonymous.newPage();
    await visitor.goto("/schedule");
    await expect(visitor.getByText(venueName, { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await anonymous.close();
  }

  // And through the proximity RPC the map runs, which is the part that depends
  // on the PostGIS point being built from the right lat/lng.
  const onMap = await page.evaluate(async (name: string) => {
    const response = await fetch("/api/dances/near", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 31.9, lng: 34.8, radiusMeters: 50_000 }),
    });
    const body = (await response.json()) as { dances?: Array<{ venueName: string }> };
    return (body.dances ?? []).some((dance) => dance.venueName === name);
  }, venueName);
  expect(onMap).toBe(true);
});

test("adding the same place twice does not create a second venue", async ({ page }) => {
  await signInAndName(page);

  async function addFirstSuggestion(): Promise<string> {
    await page.getByRole("button", { name: he.publishDance.addVenueToggle }).click();
    await page.getByLabel(he.publishDance.addVenueSearchLabel).fill(PLACE_QUERY);
    const list = page.getByRole("list", { name: he.publishDance.addVenueSuggestionsLabel });
    await expect(list).toBeVisible({ timeout: 25_000 });
    await list.getByRole("button").first().click();
    const chosen = page.getByRole("radio", { checked: true });
    await expect(chosen).toBeVisible({ timeout: 25_000 });
    return (await chosen.locator("xpath=../span/span[1]").innerText()).trim();
  }

  const name = await addFirstSuggestion();
  await page.reload();
  await expect(page.getByRole("heading", { name: he.publishDance.heading })).toBeVisible();
  const again = await addFirstSuggestion();

  expect(again).toBe(name);

  // The dedupe claim, checked where it is actually enforced rather than in the
  // UI: one row for that place, not two.
  await page.getByLabel(he.publishDance.venueSearchLabel).fill(name);
  await expect
    .poll(async () => page.getByRole("radio", { name: new RegExp(name) }).count(), {
      timeout: 10_000,
    })
    .toBe(1);
});

test("keyboard only: reach the add-venue button and the suggestion list", async ({ page }) => {
  await signInAndName(page);

  const focusedId = () => page.evaluate(() => document.activeElement?.id ?? "");
  for (let i = 0; i < 25 && (await focusedId()) !== "venue-search"; i++) {
    await page.keyboard.press("Tab");
  }
  expect(await focusedId()).toBe("venue-search");

  // Tab past the radios to the "add a venue" button and activate it with Enter.
  const isAddButton = () =>
    page.evaluate(
      (label) => document.activeElement?.textContent?.trim() === label,
      he.publishDance.addVenueToggle,
    );
  for (let i = 0; i < 15 && !(await isAddButton()); i++) {
    await page.keyboard.press("Tab");
  }
  expect(await isAddButton()).toBe(true);

  await page.keyboard.press("Enter");
  await expect(page.getByLabel(he.publishDance.addVenueSearchLabel)).toBeFocused();

  await page.keyboard.type(PLACE_QUERY);
  const list = page.getByRole("list", { name: he.publishDance.addVenueSuggestionsLabel });
  await expect(list).toBeVisible({ timeout: 25_000 });

  // Each suggestion is a real button, so Tab reaches it and it shows a ring.
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return {
      tag: document.activeElement?.tagName,
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
    };
  });
  expect(outline.tag).toBe("BUTTON");
  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
});

test("the venue picker does not scroll sideways at 200% text size", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAndName(page);

  await page.getByRole("button", { name: he.publishDance.addVenueToggle }).click();
  await page.getByLabel(he.publishDance.addVenueSearchLabel).fill(PLACE_QUERY);
  await expect(
    page.getByRole("list", { name: he.publishDance.addVenueSuggestionsLabel }),
  ).toBeVisible({ timeout: 25_000 });

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test("every venue control clears the 48x48 minimum tap target (AGENTS.md §5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signInAndName(page);
  await page.getByRole("button", { name: he.publishDance.addVenueToggle }).click();
  await page.getByLabel(he.publishDance.addVenueSearchLabel).fill(PLACE_QUERY);
  await expect(
    page.getByRole("list", { name: he.publishDance.addVenueSuggestionsLabel }),
  ).toBeVisible({ timeout: 25_000 });

  for (const control of await page.locator("fieldset button, fieldset input").all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
});
