import { test, expect } from "@playwright/test";

// A tool call renders as a tool block in the thread — UI-only assembly of the
// streamed tool-* parts into ToolBlock, plus the closing follow-up text.
test("a tool call renders in the conversation", async ({ page }) => {
  await page.goto("/?agent=helper");

  await page
    .getByPlaceholder("Message Helper")
    .fill('list it [[mock:tool:list_files:{"path":"."}]]');
  await page.getByRole("button", { name: "Send message" }).click();

  // The tool block shows the tool name...
  await expect(page.getByText("list_files").first()).toBeVisible();
  // ...and the loop closes with the follow-up text.
  await expect(page.getByText("Mock follow-up").first()).toBeVisible();
});
