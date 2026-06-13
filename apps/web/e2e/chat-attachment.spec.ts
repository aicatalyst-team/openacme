import { test, expect } from "@playwright/test";

// Attachment flow through the UI: pick a file → optimistic chip (real upload to
// /api/uploads, pending URL) → send → the committed image renders in the thread.
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

test("attach a file and send it", async ({ page }) => {
  await page.goto("/?agent=helper");

  await page.locator('input[type="file"]').setInputFiles({
    name: "pix.png",
    mimeType: "image/png",
    buffer: PNG,
  });

  // Optimistic chip for the pending upload.
  await expect(page.getByText("pix.png").first()).toBeVisible();

  await page.getByPlaceholder("Message Helper").fill("what's in this?");
  await page.getByRole("button", { name: "Send message" }).click();

  // The committed attachment renders as an image in the conversation.
  await expect(page.locator('img[alt="pix.png"]').first()).toBeVisible();
});
