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
    [...document.querySelectorAll("main li")].filter(
      (row) => row.closest("section")?.querySelector("h2") == null,
    ).length,
  );

  expect(orphans).toBe(0);
});

test("renders each dance with its night spelled out in visible text", async ({
  page,
}) => {
  await page.goto("/schedule");
  const rows = page.locator("main li");

  await expect(rows.first()).toBeVisible();

  // The rows carry no aria-label any more — they are not controls — so the
  // visible text is the whole of what gets announced.
  const text = await rows.first().innerText();
  expect(text).toMatch(/\d{2}:\d{2}/);
  expect(text).toMatch(/\S/);
});

test("a dance row has no control of its own — only the heart it was handed (Phase 4.5)", async ({
  page,
}) => {
  await page.goto("/schedule");
  const rows = page.locator("main li");

  await expect(rows.first()).toBeVisible();

  // Still no links, and still nothing focusable that isn't the one control
  // every row is deliberately given: the favorite heart. DanceRow itself
  // stays exactly as inert as before (docs/decisions/0020) — the heart is a
  // real, fully-functional action passed in from the outside, not a stub
  // this component grew on its own account.
  expect(await rows.getByRole("link").count()).toBe(0);

  const rowCount = await rows.count();
  const buttons = rows.getByRole("button");
  // One heart per row, no more — proves nothing else in the row picked up
  // an accidental button, link or aria-label of its own.
  expect(await buttons.count()).toBe(rowCount);
  for (const name of await buttons.evaluateAll((els) =>
    els.map((el) => el.getAttribute("aria-label")),
  )) {
    expect(name).toMatch(/^(הוספה למועדפים|הסרה מהמועדפים): /);
  }

  // Beyond the hearts themselves, nothing in a row carries its own
  // aria-label or tabindex.
  const strayCounts = await rows.evaluateAll((rowElements) =>
    rowElements.map(
      (row) =>
        [...row.querySelectorAll("[tabindex], [aria-label]")].filter(
          (el) => !el.getAttribute("aria-label")?.match(/מועדפים/),
        ).length,
    ),
  );
  expect(strayCounts.every((count) => count === 0)).toBe(true);
});

test("states a moved or cancelled dance in words, not only in colour", async ({
  page,
}) => {
  await page.goto("/schedule");
  const main = page.locator("main");

  // Both are seeded within the default radius — see the note in supabase/seed.sql.
  await expect(main.getByText("המיקום שונה").first()).toBeVisible();
  await expect(main.getByText(he.dance.status.cancelled).first()).toBeVisible();
});

// The 48x48 tap-target check that used to be here went with the rows' button
// semantics: §5 sizes controls, and a row is no longer one. The rows are still
// sized by their content and the ring inside them, which the 200% tests below
// exercise.

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

test("tabbing lands only on a row's heart, never anywhere else inside it (Phase 4.5)", async ({
  page,
}) => {
  // Until Phase 4.5 this asserted tabbing never landed inside a row at all —
  // true when a row had nothing on it that did anything on Enter (see the
  // comment on DanceRing that reasoning traces back to). The favorite heart
  // is not that: it is a real, fully-functional control (docs/decisions/0020),
  // so it is SUPPOSED to be a tab stop — the thing this now checks is that it
  // is the ONLY one. A button reintroduced inside a row for any other reason
  // still shows up here as a second stop this test does not expect.
  await page.goto("/schedule");
  await expect(page.locator("main li").first()).toBeVisible();

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const row = document.activeElement?.closest("main li");
      if (!row) return { inRow: false, isHeart: false };
      const label = document.activeElement?.getAttribute("aria-label") ?? "";
      return { inRow: true, isHeart: /מועדפים/.test(label) };
    });
    if (focused.inRow) expect(focused.isHeart).toBe(true);
  }
});
