import { test, expect } from "@playwright/test";

// Create an agent from scratch through the UI, then see it in the roster.
test("create an agent from scratch", async ({ page }) => {
  await page.goto("/agents");

  await page.getByRole("button", { name: "New agent" }).click();
  await page.getByRole("button", { name: /Start from scratch/ }).click();

  // Unique name so a reused local dev server doesn't collide on re-run.
  const name = `Researcher ${Date.now().toString().slice(-6)}`;
  await page.getByPlaceholder("My Agent").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // The new agent lands in the roster alongside the seeded Helper.
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
});
