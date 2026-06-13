import { test, expect } from "@playwright/test";

// The task board renders the seeded task (proves /tasks talks to the API and
// renders real cards, not just the empty-state preview).
test("task board shows the seeded task", async ({ page }) => {
  await page.goto("/tasks");

  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(page.getByText("Review the Q3 report").first()).toBeVisible();
});
