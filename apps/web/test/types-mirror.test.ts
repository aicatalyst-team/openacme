import { describe, it, expect } from "vitest";
import {
  COMMENT_KINDS,
  EVENT_KINDS,
  ALLOWED_UPLOAD_MIMES,
  UPLOAD_LIMITS,
} from "@/app/lib/types";
import {
  COMMENT_KINDS as CANONICAL_COMMENT_KINDS,
  EVENT_KINDS as CANONICAL_EVENT_KINDS,
} from "../../../packages/tasks/src/ports";

describe("hand-mirrored kind lists", () => {
  it("COMMENT_KINDS matches the canonical list in @openacme/tasks", () => {
    expect([...COMMENT_KINDS]).toEqual([...CANONICAL_COMMENT_KINDS]);
  });

  it("EVENT_KINDS matches the canonical list in @openacme/tasks", () => {
    expect([...EVENT_KINDS]).toEqual([...CANONICAL_EVENT_KINDS]);
  });

  it("kind lists contain no duplicates", () => {
    expect(new Set(COMMENT_KINDS).size).toBe(COMMENT_KINDS.length);
    expect(new Set(EVENT_KINDS).size).toBe(EVENT_KINDS.length);
  });
});

describe("upload constants", () => {
  it("ALLOWED_UPLOAD_MIMES are well-formed and unique", () => {
    for (const mime of ALLOWED_UPLOAD_MIMES) {
      expect(mime).toMatch(/^[a-z]+\/[a-z0-9.+-]+$/);
    }
    expect(new Set(ALLOWED_UPLOAD_MIMES).size).toBe(
      ALLOWED_UPLOAD_MIMES.length
    );
  });

  it("UPLOAD_LIMITS are internally consistent", () => {
    expect(UPLOAD_LIMITS.perFileBytes).toBeGreaterThan(0);
    expect(UPLOAD_LIMITS.perRequestFiles).toBeGreaterThan(0);
    expect(UPLOAD_LIMITS.perFileBytes).toBeLessThanOrEqual(
      UPLOAD_LIMITS.perRequestBytes
    );
  });
});
