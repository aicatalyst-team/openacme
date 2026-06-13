import { test, expect } from "@playwright/test";

// Full agent CRUD round-trip through the UI: create from scratch, then delete
// via the confirm dialog. The delete hits DELETE /api/agents/:id and removes
// the agent's folder on disk.
test("create then delete an agent", async ({ page }) => {
  await page.goto("/agents");

  await page.getByRole("button", { name: "New agent" }).click();
  await page.getByRole("button", { name: /Start from scratch/ }).click();
  const name = `Temp ${Date.now().toString().slice(-6)}`;
  await page.getByPlaceholder("My Agent").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();

  // The new agent's detail view is shown — delete it from there.
  await expect(page.getByText(name).first()).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();

  // Confirm in the dialog.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Delete agent?")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete" }).click();

  // Gone from the roster.
  await expect(page.getByText(name)).toHaveCount(0);
});
