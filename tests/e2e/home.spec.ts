import { expect, test } from "@playwright/test";
import { he } from "../../src/lib/i18n/he";

/**
 * The home page is now a Server Component that queries Postgres, so unlike the
 * rest of `test:e2e` this file needs the local Supabase stack running AND
 * recently seeded: `npm run db:start && npm run db:reset`. The status assertions
 * below read the seeded moved/cancelled occurrences from supabase/seed.sql — see
 * the note in that file about why they sit where they do.
 */

test("shows the nearby-dances heading", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: he.home.heading }),
  ).toBeVisible();
});

test("renders seeded dances as focusable buttons, not click-handling divs", async ({
  page,
}) => {
  await page.goto("/");
  const rings = page.getByRole("list", { name: he.home.listLabel }).getByRole("button");

  await expect(rings.first()).toBeVisible();
  expect(await rings.count()).toBeGreaterThan(0);

  // Each button's accessible name must carry the whole night, because that is
  // all a screen reader announces for it.
  const label = await rings.first().getAttribute("aria-label");
  expect(label).toMatch(/\d{2}:\d{2}/);
  expect(label).toContain("הרקדה");
});

test("states a moved or cancelled dance in words, not only in colour", async ({
  page,
}) => {
  await page.goto("/");
  const list = page.getByRole("list", { name: he.home.listLabel });

  await expect(list.getByText(he.dance.status.moved)).toBeVisible();
  await expect(list.getByText(he.dance.status.cancelled)).toBeVisible();
});

test("every dance ring clears the 48x48 minimum tap target (AGENTS.md §5)", async ({
  page,
}) => {
  await page.goto("/");
  const rings = page.getByRole("list", { name: he.home.listLabel }).getByRole("button");

  for (const ring of await rings.all()) {
    const box = await ring.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
});

test("a keyboard-focused ring gets a visible outline", async ({ page }) => {
  await page.goto("/");

  // Tabbed, not .focus(): the style is behind :focus-visible, which programmatic
  // focus does not satisfy. Asserting on outlineWidth alone is not enough either
  // — Chromium reports the UA's 1.5px even when outline-style is `none`.
  //
  // The loop is because this suite runs against `npm run dev`, whose dev-tools
  // indicator sits in the tab order ahead of the page's own content.
  const inList = () =>
    page.evaluate(
      () => document.activeElement?.closest("ul") !== null &&
        document.activeElement?.tagName === "BUTTON",
    );

  for (let i = 0; i < 6 && !(await inList()); i++) {
    await page.keyboard.press("Tab");
  }
  expect(await inList()).toBe(true);

  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });

  expect(outline.style).not.toBe("none");
  expect(outline.width).toBeGreaterThanOrEqual(2);
});

test("body font-size is set in rem, so it scales with the root font-size", async ({
  page,
}) => {
  await page.goto("/");
  const body = page.locator("body");

  const baseline = await body.evaluate((el) =>
    parseFloat(getComputedStyle(el).fontSize),
  );

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  const scaled = await body.evaluate((el) =>
    parseFloat(getComputedStyle(el).fontSize),
  );

  // 1.125rem against a 32px root computes to 36px; a px-based font-size
  // would stay at 18px regardless of the root, which is the bug this guards.
  expect(scaled).toBeCloseTo(baseline * 2, 1);
});

test("the page does not scroll horizontally at 200% text size (AGENTS.md §2.4)", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const overflows = await page.evaluate(
    () =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
