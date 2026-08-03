import { expect, test } from "@playwright/test";

test("home page renders the Hebrew placeholder text, proving the Playwright harness runs", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("לרקוד")).toBeVisible();
});
