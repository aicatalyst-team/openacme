import { test, expect } from "@playwright/test";

// Import an agent from the bundled catalog through the UI. The `?import=<id>`
// route hydrates the create form from the template; submitting POSTs the import
// (offline — builtin recommended skills) and the new agent lands in the roster.
test("import an agent from the catalog", async ({ page }) => {
  await page.goto("/agents?import=software-engineer");

  const importBtn = page.getByRole("button", { name: "Import", exact: true });
  await expect(importBtn).toBeVisible();
  await importBtn.click();

  // The imported agent (template name) is now shown.
  await expect(page.getByText("Software Engineer").first()).toBeVisible();
});
