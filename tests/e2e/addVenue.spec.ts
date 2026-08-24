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
const RECENT_FIXTURE_PREFIX = "recent-venue-e2e-";
const FIXTURE_LAT = 32.0853;
const FIXTURE_LNG = 34.7818;

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
 * Rows this suite created, recorded as it goes.
 *
 * The previous version snapshotted place_ids before the run and deleted anything
 * absent from that set afterwards. That is a sweep, not a cleanup: it deletes
 * venues another worktree's stack added while this ran, and — since the local
 * Supabase stack is shared across worktrees — a developer's real data with it.
 * Recording ids as they appear scopes the damage to exactly what this file made.
 */
const createdVenueIds = new Set<string>();

/**
 * Notes any venue that appeared since the last check.
 *
 * Called after each add, rather than deriving ids from the page, because the
 * venue is created by a Server Action and its id never reaches the DOM. Scoped
 * by place_id against a before-snapshot taken moments earlier, so a row another
 * process inserts between the two calls is not attributed to us.
 */
async function recordVenuesCreatedSince(before: Set<string>): Promise<void> {
  const rows = (await (await rest("venues?select=id,place_id")).json()) as Array<{
    id: string;
    place_id: string | null;
  }>;

  for (const row of rows) {
    if (row.place_id !== null && !before.has(row.place_id)) createdVenueIds.add(row.id);
  }
}

async function currentPlaceIds(): Promise<Set<string>> {
  const rows = (await (await rest("venues?select=place_id")).json()) as Array<{
    place_id: string | null;
  }>;
  return new Set(rows.map((row) => row.place_id).filter((id): id is string => id !== null));
}

/** Throws on a failed DELETE rather than leaving the row and reporting success. */
async function mustDelete(path: string): Promise<void> {
  const response = await rest(path, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`cleanup DELETE ${path} failed: ${response.status} ${await response.text()}`);
  }
}

async function removeVenuesCreatedByThisRun(): Promise<void> {
  for (const venueId of createdVenueIds) {
    const events = (await (
      await rest(`dance_events?select=id&venue_id=eq.${venueId}`)
    ).json()) as Array<{ id: string }>;

    // dance_events.venue_id is `on delete restrict`, so the dependencies have to
    // go first or the venue delete fails — silently, in the version this replaces.
    for (const event of events) {
      await mustDelete(`event_occurrences?event_id=eq.${event.id}`);
      await mustDelete(`dance_events?id=eq.${event.id}`);
    }
    await mustDelete(`venues?id=eq.${venueId}`);
  }
  createdVenueIds.clear();
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
  // Declares the מרקיד role on the way in (Phase 4.2, docs/decisions/0018).
  // Every test in this file publishes or manages a dance, and those surfaces are
  // now offered to instructors only — so this box IS the flow under test, not
  // setup around it. Before 4.2 the role was a side effect of publishing, which
  // is why these helpers used not to need it.
  await page.getByLabel(he.signIn.instructorLabel).check();
  await page.getByRole("button", { name: he.signIn.sendCode }).click();

  const code = page.getByLabel(he.signIn.codeLabel);
  await expect(code).toBeVisible({ timeout: 20_000 });
  await code.fill(TEST_OTP);
  await page.getByRole("button", { name: he.signIn.submitCode, exact: true }).click();

  const name = page.getByLabel(he.profileName.label);
  await expect(name).toBeVisible({ timeout: 20_000 });
  await name.fill(PROFILE_NAME);
  await page.getByRole("button", { name: he.profileName.save }).click();
  await page.getByRole("link", { name: he.profileMenu.createDance }).click();
  await expect(page).toHaveURL(/\/profile\/create-dance$/);
  await expect(page.getByRole("heading", { name: he.publishDance.heading })).toBeVisible({
    timeout: 20_000,
  });
}

async function instructorIdForTestUser(): Promise<string> {
  const { apiUrl } = localStack();
  const listed = await fetch(`${apiUrl}/auth/v1/admin/users?per_page=200`, {
    headers: headers(),
  });
  const body = (await listed.json()) as { users?: Array<{ id: string; phone?: string }> };
  const user = (body.users ?? []).find((candidate) => candidate.phone === PHONE_E164.replace("+", ""));
  if (!user) throw new Error("The signed-in test user was not found");

  const rows = (await (
    await rest(`instructors?select=id&profile_id=eq.${user.id}`)
  ).json()) as Array<{ id: string }>;
  if (rows.length !== 1) throw new Error("The signed-in test instructor was not found");
  return rows[0]!.id;
}

async function mustInsert(path: string, rows: unknown): Promise<void> {
  const response = await rest(path, { method: "POST", body: JSON.stringify(rows) });
  if (!response.ok) {
    throw new Error(`fixture POST ${path} failed: ${response.status} ${await response.text()}`);
  }
}

function dateInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

test.beforeEach(async () => {
  await resetTestUser();
});

test.afterAll(async () => {
  await resetTestUser();
  await removeVenuesCreatedByThisRun();
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
  // Scoped to the VENUE radios by name. The form grew a second radio group in
  // 3.3a (one-time / weekly / biweekly), so an unscoped count now answers a
  // different question than the one this test is asking — "is the whole table
  // still being shipped to the browser".
  expect(await page.locator('input[name="venueId"]').count()).toBe(0);
});

test("shows only the instructor's three most recently used distinct venues", async ({ page }) => {
  await signInAndName(page);
  const ownInstructorId = await instructorIdForTestUser();
  const otherRows = (await (
    await rest(`instructors?select=id&id=neq.${ownInstructorId}&limit=1`)
  ).json()) as Array<{ id: string }>;
  const otherInstructorId = otherRows[0]?.id;
  if (!otherInstructorId) throw new Error("A second instructor fixture is required");

  const fixtureVenues = [
    { id: crypto.randomUUID(), name: `${RECENT_FIXTURE_PREFIX}אחרון`, address: "רחוב ראשון 1" },
    { id: crypto.randomUUID(), name: `${RECENT_FIXTURE_PREFIX}שני`, address: "רחוב שני 2" },
    { id: crypto.randomUUID(), name: `${RECENT_FIXTURE_PREFIX}שלישי`, address: "רחוב שלישי 3" },
    { id: crypto.randomUUID(), name: `${RECENT_FIXTURE_PREFIX}ישן`, address: "רחוב רביעי 4" },
    { id: crypto.randomUUID(), name: `${RECENT_FIXTURE_PREFIX}של מרקיד אחר`, address: "רחוב חמישי 5" },
  ] as const;
  const venueIds = fixtureVenues.map((venue) => venue.id);
  for (const venueId of venueIds) createdVenueIds.add(venueId);

  try {
    await mustInsert(
      "venues",
      fixtureVenues.map((venue, index) => ({
        ...venue,
        location: `POINT(${FIXTURE_LNG + index * 0.01} ${FIXTURE_LAT})`,
        place_id: `${RECENT_FIXTURE_PREFIX}${venue.id}`,
      })),
    );

    const now = Date.now();
    await mustInsert("dance_events", [
      // The newest two own publishes use the same venue. It must appear once,
      // followed by the next two distinct venues rather than shortening the list.
      {
        id: crypto.randomUUID(),
        instructor_id: ownInstructorId,
        venue_id: fixtureVenues[0].id,
        price_agorot: 0,
        created_at: new Date(now - 1_000).toISOString(),
      },
      {
        id: crypto.randomUUID(),
        instructor_id: ownInstructorId,
        venue_id: fixtureVenues[0].id,
        price_agorot: 0,
        created_at: new Date(now - 2_000).toISOString(),
      },
      {
        id: crypto.randomUUID(),
        instructor_id: ownInstructorId,
        venue_id: fixtureVenues[1].id,
        price_agorot: 0,
        created_at: new Date(now - 3_000).toISOString(),
      },
      {
        id: crypto.randomUUID(),
        instructor_id: ownInstructorId,
        venue_id: fixtureVenues[2].id,
        price_agorot: 0,
        created_at: new Date(now - 4_000).toISOString(),
      },
      {
        id: crypto.randomUUID(),
        instructor_id: ownInstructorId,
        venue_id: fixtureVenues[3].id,
        price_agorot: 0,
        created_at: new Date(now - 5_000).toISOString(),
      },
      // Newer than every own event. An omitted ownership filter would put this
      // other instructor's venue at the top of the shortlist.
      {
        id: crypto.randomUUID(),
        instructor_id: otherInstructorId,
        venue_id: fixtureVenues[4].id,
        price_agorot: 0,
        created_at: new Date(now).toISOString(),
      },
    ]);

    await page.reload();
    const recent = page.getByRole("region", { name: he.publishDance.recentVenuesHeading });
    await expect(recent).toBeVisible();
    const radios = recent.getByRole("radio");
    await expect(radios).toHaveCount(3);
    await expect(radios.nth(0)).toHaveValue(fixtureVenues[0].id);
    await expect(radios.nth(1)).toHaveValue(fixtureVenues[1].id);
    await expect(radios.nth(2)).toHaveValue(fixtureVenues[2].id);
    await expect(recent.getByText(fixtureVenues[3].name)).toHaveCount(0);
    await expect(recent.getByText(fixtureVenues[4].name)).toHaveCount(0);
  } finally {
    for (const venueId of venueIds) {
      const events = (await (
        await rest(`dance_events?select=id&venue_id=eq.${venueId}`)
      ).json()) as Array<{ id: string }>;
      for (const event of events) {
        await mustDelete(`event_occurrences?event_id=eq.${event.id}`);
        await mustDelete(`dance_events?id=eq.${event.id}`);
      }
      await mustDelete(`venues?id=eq.${venueId}`);
      createdVenueIds.delete(venueId);
    }
  }
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

  const before = await currentPlaceIds();
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
  // order to use it, so it must not need finding again. Scope by the fieldset's
  // accessible legend: the form has other checked radio groups, while the venue
  // picker's generated input names intentionally vary between publish/edit flows.
  const chosen = page
    .getByRole("group", { name: he.publishDance.venueLabel })
    .getByRole("radio", { checked: true });
  await expect(chosen).toBeVisible({ timeout: 25_000 });
  const venueName = (await chosen.locator("xpath=../span/span[1]").innerText()).trim();
  expect(venueName.length).toBeGreaterThan(0);
  await recordVenuesCreatedSince(before);

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
    const before = await currentPlaceIds();
    await page.getByRole("button", { name: he.publishDance.addVenueToggle }).click();
    await page.getByLabel(he.publishDance.addVenueSearchLabel).fill(PLACE_QUERY);
    const list = page.getByRole("list", { name: he.publishDance.addVenueSuggestionsLabel });
    await expect(list).toBeVisible({ timeout: 25_000 });
    await list.getByRole("button").first().click();
    // Scoped to the venue fieldset — see the note on the identical pattern above.
    const chosen = page
      .getByRole("group", { name: he.publishDance.venueLabel })
      .getByRole("radio", { checked: true });
    await expect(chosen).toBeVisible({ timeout: 25_000 });
    await recordVenuesCreatedSince(before);
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
  for (let i = 0; i < 25 && (await focusedId()) !== "publish-venue-search"; i++) {
    await page.keyboard.press("Tab");
  }
  expect(await focusedId()).toBe("publish-venue-search");

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

  // Scoped to the VENUE fieldset. 3.3a added a second one to this form for the
  // repeat choice, whose tap target is the surrounding <label> rather than the
  // 24px radio inside it — the same shape the venue list itself uses, and
  // covered by tests/e2e/publishRecurringDance.spec.ts. An unscoped "every
  // fieldset input" would be measuring that group's radio, not a venue control.
  const venueFieldset = page.locator("fieldset", {
    has: page.getByText(he.publishDance.venueLabel),
  });

  for (const control of await venueFieldset.locator("button, input").all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
});
