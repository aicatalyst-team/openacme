import { describe, expect, it } from "vitest";
import type { StoredUIMessage } from "@openacme/db";
import { dbMessagesToTuiMessages } from "../src/tui/restore.js";

describe("dbMessagesToTuiMessages", () => {
  it("maps id/role/parts through", () => {
    const rows: StoredUIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "hello" }] },
    ];
    const out = dbMessagesToTuiMessages(rows);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] });
    expect(out[1]!.role).toBe("assistant");
  });

  it("includes metadata only when present", () => {
    const rows: StoredUIMessage[] = [
      { id: "m1", role: "user", parts: [], metadata: { foo: 1 } },
      { id: "m2", role: "user", parts: [] },
    ];
    const out = dbMessagesToTuiMessages(rows);
    expect((out[0] as { metadata?: unknown }).metadata).toEqual({ foo: 1 });
    expect("metadata" in (out[1] as object)).toBe(false);
  });

  it("returns an empty array for an empty history", () => {
    expect(dbMessagesToTuiMessages([])).toEqual([]);
  });
});
