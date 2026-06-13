import { test, expect } from "@playwright/test";

// The stop button is UI-only client logic: while a turn streams, it fires
// DELETE /api/sessions/:id/active-turn and the composer flips back to idle.
test("stop a running turn", async ({ page }) => {
  await page.goto("/?agent=helper");

  // `[[mock:slow]]` keeps the turn in-flight long enough to interrupt it.
  await page.getByPlaceholder("Message Helper").fill("take your time [[mock:slow]]");
  await page.getByRole("button", { name: "Send message" }).click();

  const stop = page.getByRole("button", { name: "Stop generating" });
  await expect(stop).toBeVisible();
  await stop.click();

  // Aborted → the turn is no longer running, so the stop control disappears.
  await expect(stop).toBeHidden();
});
