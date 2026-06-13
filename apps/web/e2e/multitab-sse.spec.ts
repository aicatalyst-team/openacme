import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

// The core architectural invariant: agent turns are server-owned and delivered
// over the per-session SSE channel, so every tab on a session is just a
// subscriber. Two independent browser contexts share one session; a message
// sent from tab A must stream live into tab B.
test("a turn streams live into a second tab on the same session", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  // Both tabs subscribe to the same (pre-minted) session before any POST.
  const session = randomUUID();
  await a.goto(`/?session=${session}&agent=helper`);
  await b.goto(`/?session=${session}&agent=helper`);

  // Tab A sends — the turn is owned by the server, not the originating tab.
  await a.getByPlaceholder("Message Helper").fill("hello from tab A");
  await a.getByRole("button", { name: "Send message" }).click();

  // Tab A sees its own turn (it's a subscriber like any other)...
  await expect(
    a.getByText("Mock reply. You said: hello from tab A").first()
  ).toBeVisible();

  // ...and tab B, which never posted, sees the same user message AND the
  // streamed assistant reply purely over SSE.
  await expect(b.getByText("hello from tab A").first()).toBeVisible({ timeout: 15_000 });
  await expect(
    b.getByText("Mock reply. You said: hello from tab A").first()
  ).toBeVisible({ timeout: 15_000 });

  await ctxA.close();
  await ctxB.close();
});
