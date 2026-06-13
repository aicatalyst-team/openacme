import { test, expect } from "@playwright/test";

// Create a team through the UI (the page previously only had a render check).
// A name is the only requirement; members/manager are optional.
test("create a team", async ({ page }) => {
  await page.goto("/teams");

  await page.getByRole("button", { name: "New team" }).click();
  await expect(page.getByRole("heading", { name: "New team" })).toBeVisible();

  const name = `Squad ${Date.now().toString().slice(-6)}`;
  await page.locator("#team-name").fill(name);
  await page.getByRole("button", { name: "Create team" }).click();

  // The new team is selected and shown.
  await expect(page.getByText(name).first()).toBeVisible();
});
