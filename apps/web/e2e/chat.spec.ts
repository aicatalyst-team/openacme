import { test, expect } from "@playwright/test";

// The real user journey: open a fresh chat with the seeded agent, send a
// message, and see the assistant reply stream into the page. The model is the
// injected stub, so the reply is deterministic.
test("send a message and see the streamed assistant reply", async ({ page }) => {
  await page.goto("/?agent=helper");

  const composer = page.getByPlaceholder("Message Helper");
  await expect(composer).toBeVisible();

  await composer.fill("hello from playwright");
  await page.getByRole("button", { name: "Send message" }).click();

  // The user's message echoes immediately...
  await expect(page.getByText("hello from playwright").first()).toBeVisible();
  // ...and the stub's reply streams in and persists. `.first()` — the live
  // assembly + persisted snapshot can briefly render the same text twice.
  await expect(
    page.getByText("Mock reply. You said: hello from playwright").first()
  ).toBeVisible({ timeout: 20_000 });
});
