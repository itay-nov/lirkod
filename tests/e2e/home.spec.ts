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

test("renders seeded dances, each spelling out its night in visible text", async ({
  page,
}) => {
  await page.goto("/");
  const rings = page.getByRole("list", { name: he.home.listLabel }).getByRole("listitem");

  await expect(rings.first()).toBeVisible();
  expect(await rings.count()).toBeGreaterThan(0);

  // No aria-label carries the night as one string any more (the rings are not
  // controls), so the visible text is all a screen reader gets — assert it has
  // the time and a venue rather than an empty ring.
  const text = await rings.first().innerText();
  expect(text).toMatch(/\d{2}:\d{2}/);
  expect(text).toMatch(/\S/);
});

test("no dance ring is a control while there is no detail route to reach", async ({
  page,
}) => {
  // The regression this exists for: the rings shipped as enabled <button>s with
  // no handler, so tabbing to one and pressing Enter did nothing at all.
  await page.goto("/");
  const list = page.getByRole("list", { name: he.home.listLabel });

  await expect(list.getByRole("listitem").first()).toBeVisible();
  expect(await list.getByRole("button").count()).toBe(0);
  expect(await list.getByRole("link").count()).toBe(0);
  expect(
    await list.locator("[tabindex], [aria-label]").count(),
  ).toBe(0);
});

test("states a moved or cancelled dance in words, not only in colour", async ({
  page,
}) => {
  await page.goto("/");
  const list = page.getByRole("list", { name: he.home.listLabel });

  await expect(list.getByText(he.dance.status.moved)).toBeVisible();
  await expect(list.getByText(he.dance.status.cancelled)).toBeVisible();
});

// The 48x48 tap-target check that used to live here went with the rings' button
// semantics — §5 is a rule about controls, and a ring is no longer one. The
// controls it still applies to on this screen are prev/next, asserted below.

test("tabbing never lands inside the ring list", async ({ page }) => {
  await page.goto("/");

  // Sequential Tab, not a query for [tabindex]: a div with a stray tabindex, or
  // a button reintroduced inside a ring, would both show up here and nowhere
  // else. The loop bound is generous because this suite runs against
  // `npm run dev`, whose dev-tools indicator sits in the tab order too.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const inList = await page.evaluate(
      () => document.activeElement?.closest("#dance-ring-list") !== null,
    );
    expect(inList).toBe(false);
  }
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

/**
 * The prev/next scroll controls (AGENTS.md §2.7 — the ring list must not rely on
 * scroll/swipe alone). A 1280px desktop viewport fits all five seeded rings with
 * no overflow at all, which would make every assertion here vacuous — narrowed to
 * a phone-width viewport so the list actually has somewhere to scroll to.
 */
test.describe("dance ring prev/next controls", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("prev starts disabled at the start of the list; next does not", async ({
    page,
  }) => {
    await page.goto("/");
    const prev = page.getByRole("button", { name: he.home.prevLabel });
    const next = page.getByRole("button", { name: he.home.nextLabel });

    await expect(prev).toBeDisabled();
    await expect(prev).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeEnabled();
    await expect(next).toHaveAttribute("aria-disabled", "false");
  });

  test("clicking next moves the list and enables prev", async ({ page }) => {
    await page.goto("/");
    const list = page.locator("#dance-ring-list");
    const next = page.getByRole("button", { name: he.home.nextLabel });

    const before = await list.evaluate((el) => el.scrollLeft);
    // The scroll is "instant", not animated — see the comment on scrollByPage
    // in DanceRingScroller.tsx for why a smooth one is not safe here — so the
    // new position is readable right after the click, no polling needed.
    await next.click();
    expect(await list.evaluate((el) => el.scrollLeft)).not.toBe(before);

    await expect(page.getByRole("button", { name: he.home.prevLabel })).toBeEnabled();
  });

  test("a keyboard-focused scroll control gets a visible outline", async ({ page }) => {
    await page.goto("/");

    // Tabbed, not .focus(): the style is behind :focus-visible, which
    // programmatic focus does not satisfy. Asserting on outlineWidth alone is
    // not enough either — Chromium reports the UA's 1.5px even when
    // outline-style is `none`. This moved off the rings when they stopped being
    // controls; "next" is the one enabled control on the list at phone width.
    const nextIsFocused = () =>
      page.evaluate(
        (label) => document.activeElement?.getAttribute("aria-label") === label,
        he.home.nextLabel,
      );
    for (let i = 0; i < 6 && !(await nextIsFocused()); i++) {
      await page.keyboard.press("Tab");
    }
    expect(await nextIsFocused()).toBe(true);

    const outline = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement as Element);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });

    expect(outline.style).not.toBe("none");
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });

  test("both controls clear the 48x48 minimum tap target (AGENTS.md §5)", async ({
    page,
  }) => {
    await page.goto("/");
    const controls = page.getByRole("button", {
      name: new RegExp(`${he.home.prevLabel}|${he.home.nextLabel}`),
    });

    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    }
  });

  test("keyboard-only: Enter on next repeatedly reaches the end without losing focus into the void", async ({
    page,
  }) => {
    await page.goto("/");

    // Tab past the dev server's own indicator (see the note on the outline
    // test above) until the "next" control itself is focused.
    const nextIsFocused = () =>
      page.evaluate(
        (label) => document.activeElement?.getAttribute("aria-label") === label,
        he.home.nextLabel,
      );
    for (let i = 0; i < 6 && !(await nextIsFocused()); i++) {
      await page.keyboard.press("Tab");
    }
    expect(await nextIsFocused()).toBe(true);

    // The scroll is instant and the disabled/focus decision is flushed
    // synchronously in the same click (see scrollByPage in
    // DanceRingScroller.tsx), so each iteration's state is final the moment
    // Enter returns — no wait needed between presses.
    for (let i = 0; i < 6; i++) {
      const next = page.getByRole("button", { name: he.home.nextLabel });
      if (await next.isDisabled()) break;
      await page.keyboard.press("Enter");
    }

    await expect(page.getByRole("button", { name: he.home.nextLabel })).toBeDisabled();

    const active = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      label: document.activeElement?.getAttribute("aria-label"),
      isBody: document.activeElement === document.body,
    }));
    expect(active.isBody).toBe(false);
    expect(active.tag).toBe("BUTTON");
    expect(active.label).toBe(he.home.prevLabel);

    // The control focus landed on must itself be genuinely usable — not a
    // disabled element the browser happens to still be pointing at.
    await expect(page.getByRole("button", { name: he.home.prevLabel })).toBeEnabled();
  });
});
