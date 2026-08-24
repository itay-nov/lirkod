import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { he } from "../../src/lib/i18n/he";

/**
 * The demo login and the role-gated menu behind it (docs/decisions/0018).
 *
 * Requires the local Supabase stack, a recent `npm run db:reset` (the demo cast
 * comes from supabase/seed.sql), and — unlike every other spec here — a dev
 * server started with `DEMO_LOGIN_ENABLED=true`. Without that the demo form is
 * not rendered at all and these skip rather than fail, because "no demo form in
 * a non-demo build" is the correct behaviour, not a broken test. The flag-off
 * case is asserted properly, with the session assertion the DoD asks for, in
 * tests/rls/roleAndDemoLogin.test.ts.
 *
 * Phone-width throughout: this audience is holding a phone (AGENTS.md §2).
 */
test.use({ viewport: { width: 375, height: 812 } });

/** Index 0 by convention — the seeded מרקיד. */
const INSTRUCTOR_NUMBER = "0";
/** Index 1 — a seeded רוקד, and one this file only ever READS as a dancer. */
const DANCER_NUMBER = "1";
/**
 * Index 3, reserved for the one test here that CHANGES a role.
 *
 * Deliberately not index 1: promoting the canonical dancer would leave the seed
 * describing a cast that no longer matches `DEMO_USERS`, and the next run of
 * either this file or tests/rls/roleAndDemoLogin.test.ts would be asserting
 * against a רוקד who had quietly become a מרקיד. The row is deleted again in
 * `afterEach` regardless of how the test ends.
 */
const PROMOTABLE_DANCER_NUMBER = "3";
const PROMOTABLE_DANCER_PROFILE_ID = "d1000000-0000-0000-0000-000000000003";

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
 * Puts the promotable demo dancer back to being a dancer.
 *
 * Not tidiness — correctness, in the same way `deleteTestUser` is in
 * signIn.spec.ts. The role is DERIVED from this row (docs/decisions/0018), so
 * leaving it behind is leaving the demo cast in a shape the seed does not
 * describe, and the failure would surface in a different file on a later run.
 */
async function demoteTestDancer(): Promise<void> {
  const { apiUrl, serviceRoleKey } = localStack();

  const response = await fetch(
    `${apiUrl}/rest/v1/instructors?profile_id=eq.${PROMOTABLE_DANCER_PROFILE_ID}`,
    {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`could not demote the demo dancer: ${response.status}`);
  }
}

function demoNumberField(page: Page) {
  return page.getByLabel(he.demo.signIn.numberLabel);
}

async function demoSignIn(page: Page, typedNumber: string): Promise<boolean> {
  await page.goto("/profile");

  const field = demoNumberField(page);
  if ((await field.count()) === 0) return false;

  await field.fill(typedNumber);
  await page.getByRole("button", { name: he.demo.signIn.submit }).click();

  // The greeting is the signal the server re-rendered as somebody, rather than
  // the button merely having been pressed.
  await expect(page.getByText(/^שלום, /)).toBeVisible();
  return true;
}

/**
 * Both tabs a signed-in person of EITHER role must still have. Guest reaches
 * these too (AGENTS.md §2.2) — they were never role-dependent, and this asserts
 * the role branch did not accidentally start gating navigation.
 */
async function expectSharedNavigation(page: Page) {
  const nav = page.getByRole("navigation", { name: he.nav.label });
  await expect(nav.getByRole("link", { name: he.nav.map })).toBeVisible();
  await expect(nav.getByRole("link", { name: he.nav.schedule })).toBeVisible();
}

test("number 0 signs in as the מרקיד and gets the instructor surfaces", async ({
  page,
}) => {
  test.skip(
    !(await demoSignIn(page, INSTRUCTOR_NUMBER)),
    "no demo form: run this spec against a DEMO_LOGIN_ENABLED=true server",
  );

  await expect(
    page.getByRole("heading", { name: he.publishDance.heading }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: he.manageNights.heading }),
  ).toBeVisible();

  // And is NOT offered the thing a dancer is offered.
  await expect(
    page.getByRole("heading", { name: he.profile.becomeInstructor.heading }),
  ).toHaveCount(0);

  await expectSharedNavigation(page);

  const menuButton = page.getByRole("button", { name: he.profileMenu.open });
  await menuButton.click();
  await expect(
    page.getByRole("link", { name: he.profileMenu.createDance }),
  ).toBeVisible();
});

test("number 1 signs in as a רוקד and gets no instructor surfaces", async ({
  page,
}) => {
  test.skip(
    !(await demoSignIn(page, DANCER_NUMBER)),
    "no demo form: run this spec against a DEMO_LOGIN_ENABLED=true server",
  );

  // The gate, from the dancer's side. Hiding these is presentation only — the
  // database refuses the writes regardless, which tests/rls/roleAndDemoLogin
  // asserts by calling the RPC directly with the UI bypassed.
  await expect(
    page.getByRole("heading", { name: he.publishDance.heading }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: he.manageNights.heading }),
  ).toHaveCount(0);

  // An invitation in their place, never an empty gap.
  await expect(
    page.getByRole("heading", { name: he.profile.becomeInstructor.heading }),
  ).toBeVisible();

  await expectSharedNavigation(page);

  await page.getByRole("button", { name: he.profileMenu.open }).click();
  await expect(
    page.getByRole("link", { name: he.profileMenu.createDance }),
  ).toHaveCount(0);
});

test("the personal menu traps focus, closes with Escape, and fits at 200%", async ({
  page,
}) => {
  test.skip(
    !(await demoSignIn(page, INSTRUCTOR_NUMBER)),
    "no demo form: run this spec against a DEMO_LOGIN_ENABLED=true server",
  );

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const opener = page.getByRole("button", { name: he.profileMenu.open });
  const openerBox = await opener.boundingBox();
  expect(openerBox?.width ?? 0).toBeGreaterThanOrEqual(48);
  expect(openerBox?.height ?? 0).toBeGreaterThanOrEqual(48);
  expect(openerBox?.x ?? 375).toBeLessThan(375 / 2);

  await opener.click();
  const drawer = page.getByRole("dialog");
  const close = page.getByRole("button", { name: he.profileMenu.close });
  await expect(close).toBeFocused();

  const createLink = page.getByRole("link", { name: he.profileMenu.createDance });
  await createLink.focus();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  const layout = await drawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      overflows: element.scrollWidth > element.clientWidth,
    };
  });
  expect(layout.left).toBe(0);
  expect(layout.overflows).toBe(false);

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("a number naming nobody is refused, and nobody is signed in", async ({ page }) => {
  await page.goto("/profile");

  const field = demoNumberField(page);
  test.skip(
    (await field.count()) === 0,
    "no demo form: run this spec against a DEMO_LOGIN_ENABLED=true server",
  );

  await field.fill("99");
  await page.getByRole("button", { name: he.demo.signIn.submit }).click();

  await expect(page.getByText(he.demo.signIn.errors.unknownNumber)).toBeVisible();
  // Still anonymous: no greeting, and the form is still the thing on screen.
  await expect(page.getByText(/^שלום, /)).toHaveCount(0);
  await expect(demoNumberField(page)).toBeVisible();
});

test.describe("becoming a מרקיד", () => {
  // Before AND after: a previous interrupted run must not decide this one, and
  // this one must not decide the next.
  test.beforeEach(demoteTestDancer);
  test.afterEach(demoteTestDancer);

  test("a רוקד can become a מרקיד from the personal area, and the surfaces appear", async ({
    page,
  }) => {
    test.skip(
      !(await demoSignIn(page, PROMOTABLE_DANCER_NUMBER)),
      "no demo form: run this spec against a DEMO_LOGIN_ENABLED=true server",
    );

    // The secondary role-declaration path (docs/decisions/0018). Without it,
    // gating publish by role would have left nobody able to become a מרקיד at all.
    await page.getByRole("button", { name: he.profile.becomeInstructor.cta }).click();

    await expect(
      page.getByRole("heading", { name: he.publishDance.heading }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: he.profile.becomeInstructor.heading }),
    ).toHaveCount(0);
  });
});

test("keyboard alone signs in: type the number, Tab to אישור, press Enter", async ({
  page,
}) => {
  await page.goto("/profile");

  const field = demoNumberField(page);
  test.skip(
    (await field.count()) === 0,
    "no demo form: run this spec against a DEMO_LOGIN_ENABLED=true server",
  );

  // No .click() anywhere in this test on purpose (AGENTS.md §2.7 — every action
  // has a visible, tappable control, and a keyboard must be able to reach it).
  await field.focus();
  await page.keyboard.type(INSTRUCTOR_NUMBER);
  await page.keyboard.press("Tab");

  await expect(page.getByRole("button", { name: he.demo.signIn.submit })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page.getByText(/^שלום, /)).toBeVisible();
});

test("the demo sign-in form stays usable at 200% text on a 375px phone", async ({
  page,
}) => {
  await page.goto("/profile");
  test.skip(
    (await demoNumberField(page).count()) === 0,
    "no demo form: run this spec against a DEMO_LOGIN_ENABLED=true server",
  );

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });

  const submit = page.getByRole("button", { name: he.demo.signIn.submit });
  await expect(submit).toBeVisible();

  const box = await submit.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

  // AGENTS.md §2.4: the page must not scroll sideways at 200%.
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
