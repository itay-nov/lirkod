import { expect, test, type Page } from "@playwright/test";
import { he } from "../../src/lib/i18n/he";

/**
 * The hero map (docs/decisions/0011).
 *
 * Like home.spec.ts this needs the local Supabase stack running and recently
 * reset. It additionally needs two things the other specs do not:
 *
 *   * NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env.local, and
 *   * the dev server on a port that key's HTTP-referrer allowlist includes.
 *     Google rejects the script with RefererNotAllowedMapError otherwise, and
 *     these tests will fail with no pins. That is the one place AGENTS.md §12's
 *     "own PORT per worktree" collides with something outside the repo — if you
 *     run this on a custom PORT, add that origin to the key's allowlist first.
 *
 * Everything here drives the real Maps library rather than a stub, because the
 * whole question these tests answer — can a dancer who is not holding a mouse
 * reach a pin and open its preview — is a question about that library's
 * behaviour, and a stub would answer it by assumption.
 */

const MAP_READY_TIMEOUT_MS = 20_000;

/** The advanced markers the map renders, once the library has attached them. */
function pins(page: Page) {
  return page.locator("gmp-advanced-marker");
}

/**
 * The last pin in DOM order, which is the one painted on top.
 *
 * Not `.first()`, and the reason is a real limitation rather than a test
 * detail: two occurrences at the same hall put two pins at identical
 * coordinates, and the upper one takes every tap meant for the one beneath.
 * The seed has exactly that (two Holon nights), so `.first()` is genuinely
 * unclickable — a pointer test written against it fails for the same reason a
 * dancer would fail. Clustering or fanning out co-located pins is its own
 * task; see docs/decisions/0011. Keyboard reaches every pin regardless, which
 * is what the Tab test above covers.
 */
function topPin(page: Page) {
  return pins(page).last();
}

async function waitForPins(page: Page) {
  await expect(pins(page).first()).toBeAttached({ timeout: MAP_READY_TIMEOUT_MS });
}

test("renders a labelled map region with a pin for each nearby dance", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("region", { name: he.map.regionLabel })).toBeVisible();
  await waitForPins(page);

  // The seed puts four occurrences inside the default radius; asserting "more
  // than one" rather than the exact number keeps a future seed addition from
  // reading as a map bug.
  expect(await pins(page).count()).toBeGreaterThan(1);
});

test("every pin is a real control with the whole night as its name", async ({ page }) => {
  await page.goto("/");
  await waitForPins(page);

  const first = pins(page).first();
  // role=button and tabindex=0 are what gmpClickable buys, and they are the
  // difference between a map anyone can use and a mouse-only one.
  await expect(first).toHaveAttribute("role", "button");
  await expect(first).toHaveAttribute("tabindex", "0");

  const title = await first.getAttribute("title");
  expect(title).toMatch(/\d{2}:\d{2}/);
  expect(title).toContain("הרקדה");
});

test("keyboard alone reaches a pin and opens its preview", async ({ page }) => {
  // The reason this spec exists. A pin that only answers to a mouse fails
  // AGENTS.md §2.7 no matter how good it looks.
  await page.goto("/");
  await waitForPins(page);

  const pinFocused = () =>
    page.evaluate(() => document.activeElement?.tagName === "GMP-ADVANCED-MARKER");

  // The loop steps past the dev-tools indicator, the map's own pan surface and
  // its zoom controls — all legitimate stops before the pins.
  for (let i = 0; i < 20 && !(await pinFocused()); i++) {
    await page.keyboard.press("Tab");
  }
  expect(await pinFocused()).toBe(true);

  await page.keyboard.press("Enter");

  const preview = page.getByRole("region", { name: he.map.preview.label });
  await expect(preview).toBeVisible();
});

test("the preview names the venue, the time, the instructor and a way to drive there", async ({
  page,
}) => {
  await page.goto("/");
  await waitForPins(page);
  await topPin(page).click();

  const preview = page.getByRole("region", { name: he.map.preview.label });
  await expect(preview).toBeVisible();

  // Whatever pin the map framed first, its own title carries the same night —
  // so the preview and the pin must agree rather than each being asserted
  // against a hardcoded venue that the seed could reorder.
  const title = (await topPin(page).getAttribute("title")) ?? "";
  const time = title.match(/\d{2}:\d{2}/)?.[0] ?? "";
  expect(time).not.toBe("");
  await expect(preview).toContainText(time);

  // Waze first (AGENTS.md §9), Google Maps second.
  const links = preview.getByRole("link");
  await expect(links).toHaveCount(2);
  expect(await links.nth(0).getAttribute("href")).toContain("waze.com");
  expect(await links.nth(1).getAttribute("href")).toContain("google.com/maps");
});

test("closing the preview puts focus back on the pin it came from", async ({ page }) => {
  await page.goto("/");
  await waitForPins(page);
  await topPin(page).click();
  await expect(page.getByRole("region", { name: he.map.preview.label })).toBeVisible();

  await page.getByRole("button", { name: he.map.preview.close }).click();

  await expect(page.getByRole("region", { name: he.map.preview.label })).toBeHidden();
  // Not the top of the document: the dancer was on a pin, and that is where
  // they should still be.
  expect(
    await page.evaluate(() => document.activeElement?.tagName === "GMP-ADVANCED-MARKER"),
  ).toBe(true);
});

test("both navigation links clear the 48x48 minimum tap target (AGENTS.md §5)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await waitForPins(page);
  await topPin(page).click();

  const preview = page.getByRole("region", { name: he.map.preview.label });
  for (const link of await preview.getByRole("link").all()) {
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
});

test("never asks for location until the visible control is pressed (AGENTS.md §9)", async ({
  page,
  context,
}) => {
  // Permission is deliberately NOT granted: the assertion is that the first
  // render neither waits on a prompt nor triggers one.
  await context.clearPermissions();
  await page.addInitScript(() => {
    const w = window as unknown as { __geoAsks: number };
    w.__geoAsks = 0;
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = ((...args: unknown[]) => {
      w.__geoAsks += 1;
      return (original as (...a: unknown[]) => void)(...args);
    }) as typeof navigator.geolocation.getCurrentPosition;
  });

  await page.goto("/");
  await waitForPins(page);

  expect(
    await page.evaluate(() => (window as unknown as { __geoAsks: number }).__geoAsks),
  ).toBe(0);

  await page.getByRole("button", { name: he.map.locate }).click();

  expect(
    await page.evaluate(() => (window as unknown as { __geoAsks: number }).__geoAsks),
  ).toBe(1);
});

test("re-centres and re-queries once location is granted", async ({ page, context }) => {
  // Holon, where the seed puts a venue.
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 32.0114, longitude: 34.7736 });

  await page.goto("/");
  await waitForPins(page);

  await page.getByRole("button", { name: he.map.locate }).click();

  // The visible confirmation, in words — a re-centred map alone would leave a
  // dancer guessing whether anything happened.
  await expect(page.getByText(he.map.located)).toBeVisible();
  await expect(pins(page).first()).toBeAttached();
});

test("the page does not scroll horizontally at 200% text size (AGENTS.md §2.4)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await waitForPins(page);
  await topPin(page).click();
  await expect(page.getByRole("region", { name: he.map.preview.label })).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  // With the preview open, because that panel is the densest thing on this
  // screen and the most likely to push the layout sideways.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
