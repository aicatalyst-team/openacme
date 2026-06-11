import { describe, it, expect } from "vitest";
import { cn } from "@/app/lib/utils";

describe("cn", () => {
  it("joins multiple class strings", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy inputs", () => {
    expect(cn("a", false, null, undefined, "", 0, "b")).toBe("a b");
  });

  it("supports conditional object syntax", () => {
    expect(cn("base", { active: true, hidden: false })).toBe("base active");
  });

  it("flattens nested arrays", () => {
    expect(cn(["a", ["b", { c: true }]])).toBe("a b c");
  });

  it("resolves tailwind conflicts in favor of the last class", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("keeps non-conflicting tailwind classes", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
    expect(cn("text-sm", "text-red-500")).toBe("text-sm text-red-500");
  });

  it("returns an empty string for no inputs", () => {
    expect(cn()).toBe("");
  });
});
