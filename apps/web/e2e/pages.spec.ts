import { test, expect } from "@playwright/test";

// Each of these pages drives its own API surface off the live daemon. Asserting
// a real anchor (not just the app shell) proves the route mounts and renders.

test("teams page renders", async ({ page }) => {
  await page.goto("/teams");
  await expect(page.getByRole("heading", { name: "Teams" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New team" })).toBeVisible();
});

test("skills page renders its tabs", async ({ page }) => {
  await page.goto("/skills");
  await expect(page.getByRole("tab", { name: "Installed" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Browse" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sources" })).toBeVisible();
});

test("usage page renders", async ({ page }) => {
  await page.goto("/usage");
  await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
});
