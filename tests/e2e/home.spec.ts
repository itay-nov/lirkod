import { expect, test } from "@playwright/test";

test("home page renders the Hebrew placeholder text, proving the Playwright harness runs", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("לרקוד")).toBeVisible();
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
