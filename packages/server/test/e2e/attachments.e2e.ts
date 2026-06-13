import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2EServer, type E2EServer } from "./support/harness.js";
import { makeClient, waitUntil } from "./support/client.js";

// Attachments: upload → send → server commits the pending file under the
// session and serves it back at the rewritten URL.
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe("attachments (e2e)", () => {
  let srv: E2EServer;
  let c: ReturnType<typeof makeClient>;

  beforeAll(async () => {
    srv = await startE2EServer();
    c = makeClient(srv.baseUrl);
    await c.createAgent("helper");
  });
  afterAll(async () => {
    await srv.close();
  });

  it("uploads, attaches to a turn, commits and serves the file", async () => {
    const form = new FormData();
    form.append("files", new File([PNG_BYTES], "pix.png", { type: "image/png" }));
    const up = await c.req("/api/uploads", { method: "POST", body: form });
    expect(up.status).toBe(200);
    const att = (await up.json()).attachments[0] as { pendingId: string; url: string; filename: string };
    expect(att.url).toContain("__pending__");

    // Pending file is already servable (for the optimistic preview).
    expect((await c.req(att.url)).status).toBe(200);

    const sessionId = randomUUID();
    const res = await c.post("/api/chat", {
      agentId: "helper",
      sessionId,
      messages: [
        {
          id: randomUUID(),
          role: "user",
          parts: [
            { type: "text", text: "what's in this image?" },
            { type: "file", url: att.url, mediaType: "image/png", filename: att.filename },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);

    // The server commits the pending file: the persisted user message's file
    // URL is rewritten under the session, no longer __pending__.
    await waitUntil(async () => {
      const msgs = await c.messages(sessionId);
      const fp = msgs.find((m) => m.role === "user")?.parts.find((p) => p?.type === "file");
      return !!fp && !fp.url.includes("__pending__") && fp.url.includes(sessionId);
    });

    const fp = (await c.messages(sessionId))
      .find((m) => m.role === "user")!
      .parts.find((p: any) => p?.type === "file");
    const served = await c.req(fp.url);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG_BYTES);
  });
});
