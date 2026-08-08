import { expect, test, type Page } from "@playwright/test";
import { he } from "../../src/lib/i18n/he";

/**
 * The navigation shell. Like home.spec.ts this needs the local Supabase stack
 * running and recently reset, because every route renders the shell and the map
 * route inside it queries Postgres.
 *
 * Phone-width throughout: the tab bar is a mobile-first surface and the whole
 * point of AGENTS.md §2 is the person holding a phone.
 */
test.use({ viewport: { width: 375, height: 812 } });

const TABS = [
  { label: he.nav.map, path: "/", heading: he.home.heading },
  { label: he.nav.schedule, path: "/schedule", heading: he.schedule.heading },
  { label: he.nav.profile, path: "/profile", heading: he.profile.heading },
];

function tabLink(page: Page, label: string) {
  return page.getByRole("navigation", { name: he.nav.label }).getByRole("link", {
    name: label,
  });
}

test("every tab is a real route: the URL changes and the screen follows", async ({
  page,
}) => {
  await page.goto("/");

  for (const tab of TABS) {
    await tabLink(page, tab.label).click();

    // The URL is the assertion that matters — client state pretending to be
    // navigation would pass a heading check and fail this one.
    await expect(page).toHaveURL(new RegExp(`${tab.path === "/" ? "/$" : tab.path}`));
    await expect(page.getByRole("heading", { name: tab.heading })).toBeVisible();
  }
});

test("browser back and forward walk the history the tabs built", async ({ page }) => {
  await page.goto("/");
  await tabLink(page, he.nav.schedule).click();
  await expect(page).toHaveURL(/\/schedule$/);
  await tabLink(page, he.nav.profile).click();
  await expect(page).toHaveURL(/\/profile$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(page.getByRole("heading", { name: he.schedule.heading })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: he.home.heading })).toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/\/schedule$/);
  await expect(page.getByRole("heading", { name: he.schedule.heading })).toBeVisible();
});

test("exactly one tab carries aria-current, and it is the one you are on", async ({
  page,
}) => {
  for (const tab of TABS) {
    await page.goto(tab.path);

    const current = page
      .getByRole("navigation", { name: he.nav.label })
      .locator('a[aria-current="page"]');

    await expect(current).toHaveCount(1);
    await expect(current).toHaveAccessibleName(tab.label);
  }
});

test("a direct visit to a tab route works, not just a click from inside the app", async ({
  page,
}) => {
  // Deep links matter here: AGENTS.md §2.1 expects a link pasted into WhatsApp
  // to land somewhere real without an app shell having booted first.
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: he.profile.heading })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: he.nav.label }).locator('a[aria-current="page"]'),
  ).toHaveAccessibleName(he.nav.profile);
});

test("profile carries the merged favorites section, labeled, alongside its own content", async ({
  page,
}) => {
  // Favorites used to be its own route/tab; it is now a labeled section inside
  // /profile (docs/decisions/0008). Both headings must be real, in-document
  // headings — not the same text repeated, which would make them indistinguishable
  // to a screen reader user tabbing through headings.
  await page.goto("/profile");

  await expect(
    page.getByRole("heading", { level: 1, name: he.profile.heading }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: he.favorites.heading }),
  ).toBeVisible();
});

test("keyboard-only: plain Tab reaches all three tabs, each with a visible focus ring", async ({
  page,
}) => {
  // /profile rather than /: this test needs a screen where the tab bar is the
  // only focusable thing, so that a plain Tab from the first press asserts the
  // bar's own order rather than skipping past page content to find it. The
  // map's ring scroller owns the first two stops. (/schedule would also do now
  // that its rows are not focusable, but /profile is the one screen guaranteed
  // to stay that way.) When it gains a sign-in control, this needs the
  // skip-ahead loop the Enter-navigates test below already uses.
  await page.goto("/profile");

  const reached: Array<{ href: string | null; outlineStyle: string; outlineWidth: number }> =
    [];
  for (let i = 0; i < TABS.length; i++) {
    await page.keyboard.press("Tab");
    reached.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        const style = getComputedStyle(el as Element);
        return {
          href: el?.tagName === "A" ? el.getAttribute("href") : null,
          outlineStyle: style.outlineStyle,
          outlineWidth: parseFloat(style.outlineWidth),
        };
      }),
    );
  }

  // Sequential Tab, not .focus(): a tabindex={-1} or a div-with-onClick would
  // still pass a programmatic focus test and fail this one.
  expect(reached.map((r) => r.href)).toEqual(TABS.map((t) => t.path));
  for (const stop of reached) {
    expect(stop.outlineStyle).not.toBe("none");
    expect(stop.outlineWidth).toBeGreaterThanOrEqual(2);
  }
});

test("keyboard-only: Enter on a tabbed-to tab navigates", async ({ page }) => {
  await page.goto("/schedule");

  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const href = await page.evaluate(() =>
      document.activeElement?.tagName === "A"
        ? document.activeElement.getAttribute("href")
        : null,
    );
    if (href === "/profile") break;
  }

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: he.profile.heading })).toBeVisible();
});

test("every tab clears the 48x48 minimum tap target (AGENTS.md §5)", async ({
  page,
}) => {
  await page.goto("/");

  for (const tab of TABS) {
    const box = await tabLink(page, tab.label).boundingBox();
    expect(box).not.toBeNull();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
  }
});

test("the tab bar never overlaps the content above it", async ({ page }) => {
  await page.goto("/");

  const gap = await page.evaluate(() => {
    const main = document.querySelector("main");
    const nav = document.querySelector("nav");
    if (!main || !nav) return null;
    // A fixed bar with mismatched padding would show up as a negative gap here.
    return nav.getBoundingClientRect().top - main.getBoundingClientRect().bottom;
  });

  expect(gap).not.toBeNull();
  expect(gap ?? -1).toBeGreaterThanOrEqual(0);
});

test("at 200% text size the tab bar still fits its labels and stays on screen", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const nav = page.getByRole("navigation", { name: he.nav.label });
  await expect(nav).toBeVisible();

  for (const tab of TABS) {
    await expect(tabLink(page, tab.label)).toBeVisible();
  }

  const report = await page.evaluate(() => {
    const nav = document.querySelector("nav");
    if (!nav) return null;
    const rect = nav.getBoundingClientRect();
    const labels = [...nav.querySelectorAll("a > span:last-child")];
    return {
      withinViewport: rect.bottom <= window.innerHeight + 1 && rect.top >= 0,
      // scrollWidth beyond clientWidth is text cut off by its own box, which is
      // exactly the clipping this test exists to catch.
      clipped: labels.some(
        (el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1,
      ),
      // A Range over the text node reports one ClientRect per visual line, so
      // this is a direct measurement of "did the label wrap" — not a proxy
      // like box height, which a wrapped-but-not-clipped label (the actual bug
      // with four tabs, per docs/decisions/0007) would pass undetected.
      wrapped: labels.some((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects().length > 1;
      }),
      navHeightRatio: rect.height / window.innerHeight,
    };
  });

  expect(report).not.toBeNull();
  expect(report?.withinViewport).toBe(true);
  expect(report?.clipped).toBe(false);
  // This is the assertion that matters for this fix specifically: with four
  // tabs "מועדפים" wrapped mid-word onto a second line even though nothing was
  // clipped, which is why `clipped` alone was not sufficient to catch it.
  expect(report?.wrapped).toBe(false);
  // A bar eating more than a third of a phone screen would be a usability
  // failure even though nothing is technically clipped.
  expect(report?.navHeightRatio ?? 1).toBeLessThan(0.34);
});

test("the page itself does not scroll horizontally at 200% on any tab", async ({
  page,
}) => {
  for (const tab of TABS) {
    await page.goto(tab.path);
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "32px";
    });

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, `${tab.path} overflows horizontally at 200%`).toBe(false);
  }
});
