import { test, expect } from "@playwright/test";

// Settings → Context: edit the shared AGENTS.md context and confirm it persists
// across a reload (round-trips through the server).
test("edit shared context and persist it", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Context" }).click();

  const editor = page.getByPlaceholder(/Describe what this setup is/);
  await expect(editor).toBeVisible();

  const marker = `E2E context marker ${Date.now().toString().slice(-6)}`;
  await editor.fill(marker);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await page.reload();
  await page.getByRole("tab", { name: "Context" }).click();
  // The server stores AGENTS.md with a trailing newline, so match on substring.
  await expect(page.getByPlaceholder(/Describe what this setup is/)).toHaveValue(new RegExp(marker));
});
