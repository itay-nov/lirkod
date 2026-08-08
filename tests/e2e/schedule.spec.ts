import { expect, test } from "@playwright/test";
import { he } from "../../src/lib/i18n/he";

/**
 * Like tests/e2e/home.spec.ts, this reads real rows: /schedule is a Server
 * Component querying Postgres, so the local stack must be running and recently
 * seeded (`npm run db:start && npm run db:reset`).
 *
 * Counts are asserted as "more than one day" rather than as an exact number.
 * supabase/seed.sql currently puts four in-radius occurrences on four separate
 * days, but pinning that number here would make every future seed addition look
 * like a schedule bug; what this screen actually promises is that dances arrive
 * grouped under day headers, and that is what these assert.
 */

test("shows the schedule heading", async ({ page }) => {
  await page.goto("/schedule");
  await expect(
    page.getByRole("heading", { level: 1, name: he.schedule.heading }),
  ).toBeVisible();
});

test("groups seeded dances under more than one day header", async ({ page }) => {
  await page.goto("/schedule");
  const dayHeadings = page.getByRole("heading", { level: 2 });

  expect(await dayHeadings.count()).toBeGreaterThan(1);
  // Hebrew weekday name, not an ISO key: "2025-06-02" leaking into the UI is
  // the most likely way this screen breaks AGENTS.md §2.8.
  await expect(dayHeadings.first()).toContainText("יום");
});

test("names each day in Hebrew rather than showing the grouping key", async ({
  page,
}) => {
  await page.goto("/schedule");
  const body = await page.locator("main").innerText();

  expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}/);
});

test("puts every dance row inside a day section, never loose on the page", async ({
  page,
}) => {
  await page.goto("/schedule");
  await expect(page.getByRole("listitem").first()).toBeVisible();

  const orphans = await page.evaluate(() =>
    [...document.querySelectorAll("main li button")].filter(
      (button) => button.closest("section")?.querySelector("h2") == null,
    ).length,
  );

  expect(orphans).toBe(0);
});

test("renders dances as focusable buttons carrying the whole night in one label", async ({
  page,
}) => {
  await page.goto("/schedule");
  const rows = page.locator("main li").getByRole("button");

  await expect(rows.first()).toBeVisible();

  const label = await rows.first().getAttribute("aria-label");
  expect(label).toMatch(/\d{2}:\d{2}/);
  expect(label).toContain("הרקדה");
});

test("states a moved or cancelled dance in words, not only in colour", async ({
  page,
}) => {
  await page.goto("/schedule");
  const main = page.locator("main");

  // Both are seeded within the default radius — see the note in supabase/seed.sql.
  await expect(main.getByText(he.dance.status.moved).first()).toBeVisible();
  await expect(main.getByText(he.dance.status.cancelled).first()).toBeVisible();
});

test("every dance row clears the 48x48 minimum tap target (AGENTS.md §5)", async ({
  page,
}) => {
  await page.goto("/schedule");
  const rows = page.locator("main li").getByRole("button");

  for (const row of await rows.all()) {
    const box = await row.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
});

test("the page does not scroll horizontally at 200% text size (AGENTS.md §2.4)", async ({
  page,
}) => {
  await page.goto("/schedule");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test("shows venue names in full at 200% on a phone, not cut to an ellipsis", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/schedule");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  // Not just "does it overflow": a `truncate` on the venue name passes an
  // overflow check and still leaves a dancer reading "היכל …", unable to tell
  // which hall. §2.4 asks for usable at 200%, so assert the whole name is
  // actually rendered — this is the regression that sent the row from
  // truncating to wrapping.
  const venue = "היכל התרבות חולון";
  const row = page.locator("main li").filter({ hasText: venue }).first();
  await expect(row).toBeVisible();

  const clipped = await row.evaluate((element) =>
    [...element.querySelectorAll("span")].some(
      (span) => span.scrollWidth > span.clientWidth + 1,
    ),
  );
  expect(clipped).toBe(false);

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});

test("keyboard alone walks the rows in the order they are shown", async ({ page }) => {
  await page.goto("/schedule");

  const rows = page.locator("main li").getByRole("button");
  const shown = await rows.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("aria-label") ?? ""),
  );
  expect(shown.length).toBeGreaterThan(1);

  const focusedRowLabel = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      return active?.tagName === "BUTTON" && active.closest("main li") !== null
        ? (active.getAttribute("aria-label") ?? "")
        : null;
    });

  // Tab past the dev server's own indicator and the tab bar's links (see the
  // note in home.spec.ts) until focus lands on the first row.
  for (let i = 0; i < 10 && (await focusedRowLabel()) === null; i++) {
    await page.keyboard.press("Tab");
  }

  const reached: string[] = [];
  for (let i = 0; i < shown.length; i++) {
    const label = await focusedRowLabel();
    if (label === null) break;
    reached.push(label);
    await page.keyboard.press("Tab");
  }

  expect(reached).toEqual(shown);
});
