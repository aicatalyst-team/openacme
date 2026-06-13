import { test, expect } from "@playwright/test";

// Smoke: the SPA boots, the shell renders, and it can talk to the API
// (the seeded "Helper" agent shows up on /agents).
test("app shell renders and lists the seeded agent", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/openacme/i);

  await page.goto("/agents");
  await expect(page.getByText("Helper", { exact: false }).first()).toBeVisible();
});
