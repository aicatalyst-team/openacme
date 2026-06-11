import { describe, expect, it } from "vitest";
import type { UIMessage } from "@openacme/agent-core";
import { initState, reducer, type AppState, type PendingAttachment } from "../src/tui/state.js";

function base(over?: Partial<Parameters<typeof initState>[0]>): AppState {
  return initState({
    agentId: "a1",
    agentName: "Agent One",
    modelLabel: "sonnet",
    sessionId: "sess-1",
    view: "chat",
    ...over,
  });
}

function userMsg(id = "u1", text = "hello"): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] } as UIMessage;
}

function att(p: string): PendingAttachment {
  return { sourcePath: p, filename: "f.png", mediaType: "image/png", size: 1, kind: "image" };
}

describe("initState", () => {
  it("defaults to the sessions view with empty history", () => {
    const s = initState({ agentId: "a", agentName: "A", modelLabel: "m", sessionId: "s" });
    expect(s.view).toBe("sessions");
    expect(s.committed).toEqual([]);
    expect(s.inflight).toBeNull();
    expect(s.status).toBe("idle");
    expect(s.totalTokens).toBe(0);
  });
});

describe("user-submit", () => {
  it("commits the message, starts streaming, clears pending input state", () => {
    let s = base();
    s = { ...s, pendingAttachments: [att("/x")], attachNotice: "n", lastError: "e", paletteOpen: true };
    s = reducer(s, { type: "user-submit", message: userMsg() });
    expect(s.committed.map((m) => m.id)).toEqual(["u1"]);
    expect(s.status).toBe("streaming");
    expect(s.inflight).toBeNull();
    expect(s.pendingAttachments).toEqual([]);
    expect(s.attachNotice).toBeUndefined();
    expect(s.lastError).toBeUndefined();
    expect(s.paletteOpen).toBe(false);
  });
});

describe("stream assembly", () => {
  it("stream-start creates an empty in-flight assistant message", () => {
    const s = reducer(base(), { type: "stream-start", assistantId: "as1" });
    expect(s.inflight).toEqual({ id: "as1", role: "assistant", parts: [] });
  });

  it("merges consecutive text deltas into one text part", () => {
    let s = reducer(base(), { type: "stream-start", assistantId: "as1" });
    s = reducer(s, { type: "stream-text-delta", text: "Hel" });
    s = reducer(s, { type: "stream-text-delta", text: "lo" });
    expect(s.inflight!.parts).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("ignores text deltas with no in-flight message", () => {
    const s = base();
    expect(reducer(s, { type: "stream-text-delta", text: "x" })).toBe(s);
  });

  it("upgrades a tool part through input-start -> call -> result", () => {
    let s = reducer(base(), { type: "stream-start", assistantId: "as1" });
    s = reducer(s, { type: "stream-tool-input-start", toolCallId: "t1", toolName: "shell" });
    expect(s.inflight!.parts).toEqual([
      { type: "tool-shell", toolCallId: "t1", state: "input-streaming", input: undefined },
    ]);

    s = reducer(s, { type: "stream-tool-call", toolCallId: "t1", toolName: "shell", input: { cmd: "ls" } });
    expect(s.inflight!.parts).toHaveLength(1);
    expect(s.inflight!.parts[0]).toMatchObject({ state: "input-available", input: { cmd: "ls" } });

    s = reducer(s, { type: "stream-tool-result", toolCallId: "t1", output: "ok" });
    expect(s.inflight!.parts[0]).toMatchObject({ state: "output-available", output: "ok" });
  });

  it("leaves other tool parts untouched when a result lands", () => {
    let s = reducer(base(), { type: "stream-start", assistantId: "as1" });
    s = reducer(s, { type: "stream-tool-call", toolCallId: "t1", toolName: "shell", input: {} });
    s = reducer(s, { type: "stream-tool-call", toolCallId: "t2", toolName: "read_file", input: {} });
    s = reducer(s, { type: "stream-tool-result", toolCallId: "t2", output: "data" });
    expect(s.inflight!.parts[0]).toMatchObject({ toolCallId: "t1", state: "input-available" });
    expect(s.inflight!.parts[1]).toMatchObject({ toolCallId: "t2", state: "output-available" });
  });

  it("starts a fresh text part after a tool part", () => {
    let s = reducer(base(), { type: "stream-start", assistantId: "as1" });
    s = reducer(s, { type: "stream-text-delta", text: "before " });
    s = reducer(s, { type: "stream-tool-call", toolCallId: "t1", toolName: "shell", input: {} });
    s = reducer(s, { type: "stream-text-delta", text: "after" });
    expect(s.inflight!.parts).toHaveLength(3);
    expect(s.inflight!.parts[2]).toEqual({ type: "text", text: "after" });
  });
});

describe("stream-done", () => {
  function streaming(): AppState {
    let s = reducer(base(), { type: "user-submit", message: userMsg() });
    s = reducer(s, { type: "stream-start", assistantId: "as1" });
    s = reducer(s, { type: "stream-text-delta", text: "hi" });
    return s;
  }

  it("prefers the SDK responseMessage over the accumulated inflight", () => {
    const canonical = { id: "as1", role: "assistant", parts: [{ type: "text", text: "canonical" }] } as UIMessage;
    const s = reducer(streaming(), { type: "stream-done", responseMessage: canonical, usage: undefined });
    expect(s.committed.at(-1)).toBe(canonical);
    expect(s.inflight).toBeNull();
    expect(s.status).toBe("idle");
  });

  it("falls back to the in-flight message when responseMessage is null", () => {
    const s = reducer(streaming(), { type: "stream-done", responseMessage: null });
    expect(s.committed.at(-1)).toMatchObject({ id: "as1", parts: [{ type: "text", text: "hi" }] });
  });

  it("commits nothing if there was neither", () => {
    const s0 = reducer(base(), { type: "user-submit", message: userMsg() });
    const s = reducer(s0, { type: "stream-done", responseMessage: null });
    expect(s.committed).toHaveLength(1);
    expect(s.status).toBe("idle");
  });

  it("accumulates totalTokens from usage", () => {
    let s = reducer(streaming(), { type: "stream-done", responseMessage: null, usage: { totalTokens: 100 } });
    s = reducer(s, { type: "stream-start", assistantId: "as2" });
    s = reducer(s, { type: "stream-done", responseMessage: null, usage: { totalTokens: 50 } });
    expect(s.totalTokens).toBe(150);
  });

  it("derives totalTokens from input+output when the SDK omits it", () => {
    const s = reducer(streaming(), {
      type: "stream-done",
      responseMessage: null,
      usage: { inputTokens: 30, outputTokens: 12 },
    });
    expect(s.totalTokens).toBe(42);
  });

  it("preserves error status set mid-stream", () => {
    let s = reducer(streaming(), { type: "stream-error", error: "boom" });
    expect(s.status).toBe("error");
    expect(s.lastError).toBe("boom");
    s = reducer(s, { type: "stream-done", responseMessage: null });
    expect(s.status).toBe("error");
  });
});

describe("session lifecycle", () => {
  it("new-session resets history and mints a new session id", () => {
    let s = reducer(base(), { type: "user-submit", message: userMsg() });
    const prevId = s.sessionId;
    s = reducer(s, { type: "new-session" });
    expect(s.view).toBe("chat");
    expect(s.committed).toEqual([]);
    expect(s.inflight).toBeNull();
    expect(s.sessionId).not.toBe(prevId);
    expect(s.status).toBe("idle");
    expect(s.totalTokens).toBe(0);
  });

  it("clear empties committed but keeps the session", () => {
    let s = reducer(base(), { type: "user-submit", message: userMsg() });
    const id = s.sessionId;
    s = reducer(s, { type: "clear" });
    expect(s.committed).toEqual([]);
    expect(s.sessionId).toBe(id);
  });

  it("set-session loads history and switches agent context", () => {
    const history = [userMsg("u9")];
    const s = reducer(base(), {
      type: "set-session",
      sessionId: "sess-2",
      agentId: "a2",
      agentName: "Agent Two",
      modelLabel: "opus",
      committed: history,
    });
    expect(s).toMatchObject({
      view: "chat",
      sessionId: "sess-2",
      agentId: "a2",
      committed: history,
      status: "idle",
      totalTokens: 0,
    });
  });

  it("enter-sessions closes overlays and drops transient input state", () => {
    let s = { ...base(), showHelp: true, modelPickerOpen: true, pendingAttachments: [att("/x")] };
    s = reducer(s, { type: "enter-sessions" });
    expect(s.view).toBe("sessions");
    expect(s.showHelp).toBe(false);
    expect(s.modelPickerOpen).toBe(false);
    expect(s.pendingAttachments).toEqual([]);
  });
});

describe("attachments", () => {
  it("attach-add appends and dedupes by sourcePath", () => {
    let s = reducer(base(), { type: "attach-add", attachment: att("/a") });
    s = reducer(s, { type: "attach-add", attachment: att("/b") });
    const dup = reducer(s, { type: "attach-add", attachment: att("/a") });
    expect(dup).toBe(s);
    expect(s.pendingAttachments.map((p) => p.sourcePath)).toEqual(["/a", "/b"]);
  });

  it("attach-remove filters by sourcePath; attach-clear empties", () => {
    let s = reducer(base(), { type: "attach-add", attachment: att("/a") });
    s = reducer(s, { type: "attach-add", attachment: att("/b") });
    s = reducer(s, { type: "attach-remove", sourcePath: "/a" });
    expect(s.pendingAttachments.map((p) => p.sourcePath)).toEqual(["/b"]);
    s = reducer(s, { type: "attach-clear" });
    expect(s.pendingAttachments).toEqual([]);
  });

  it("attach-notice sets the one-shot notice and attach-add clears it", () => {
    let s = reducer(base(), { type: "attach-notice", message: "not found: x" });
    expect(s.attachNotice).toBe("not found: x");
    s = reducer(s, { type: "attach-add", attachment: att("/a") });
    expect(s.attachNotice).toBeUndefined();
  });
});

describe("overlays", () => {
  it("open-* flags the overlay and closes the palette", () => {
    let s = reducer(base(), { type: "open-palette" });
    expect(s.paletteOpen).toBe(true);
    s = reducer(s, { type: "open-model-picker" });
    expect(s.modelPickerOpen).toBe(true);
    expect(s.paletteOpen).toBe(false);
  });

  it("close-overlays clears every overlay flag", () => {
    let s = {
      ...base(),
      showHelp: true,
      paletteOpen: true,
      modelPickerOpen: true,
      agentPickerOpen: true,
      skillsOverlayOpen: true,
      mcpOverlayOpen: true,
      tasksOverlayOpen: true,
    };
    s = reducer(s, { type: "close-overlays" });
    expect(s).toMatchObject({
      showHelp: false,
      paletteOpen: false,
      modelPickerOpen: false,
      agentPickerOpen: false,
      skillsOverlayOpen: false,
      mcpOverlayOpen: false,
      tasksOverlayOpen: false,
    });
  });
});

describe("set-agent", () => {
  it("switches agent, resets history and mints a new session", () => {
    let s = reducer(base(), { type: "user-submit", message: userMsg() });
    const prevSession = s.sessionId;
    s = reducer(s, { type: "set-agent", agentId: "a2", agentName: "Two", modelLabel: "opus" });
    expect(s.agentId).toBe("a2");
    expect(s.committed).toEqual([]);
    expect(s.sessionId).not.toBe(prevSession);
    expect(s.totalTokens).toBe(0);
    expect(s.agentPickerOpen).toBe(false);
  });
});
