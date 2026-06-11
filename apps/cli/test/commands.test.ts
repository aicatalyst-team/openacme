import { describe, expect, it } from "vitest";
import { COMMANDS, findCommand, filterCommands } from "../src/tui/commands.js";

describe("findCommand", () => {
  it("matches a bare name and a slash-prefixed name", () => {
    expect(findCommand("new")?.name).toBe("new");
    expect(findCommand("/new")?.name).toBe("new");
  });

  it("ignores trailing arguments", () => {
    expect(findCommand("/new something else")?.name).toBe("new");
  });

  it("is case-insensitive", () => {
    expect(findCommand("/NEW")?.name).toBe("new");
  });

  it("matches aliases", () => {
    expect(findCommand("/quit")?.name).toBe("exit");
  });

  it("returns undefined for unknown or empty input", () => {
    expect(findCommand("/nope")).toBeUndefined();
    expect(findCommand("")).toBeUndefined();
    expect(findCommand("/")).toBeUndefined();
    expect(findCommand("   ")).toBeUndefined();
  });

  it("does not prefix-match — /ne is not /new", () => {
    expect(findCommand("/ne")).toBeUndefined();
  });
});

describe("filterCommands", () => {
  it("returns the full table for an empty query", () => {
    expect(filterCommands("")).toEqual(COMMANDS);
    expect(filterCommands("/")).toEqual(COMMANDS);
  });

  it("prefix-matches names", () => {
    expect(filterCommands("/ne").map((c) => c.name)).toEqual(["new"]);
  });

  it("prefix-matches aliases", () => {
    expect(filterCommands("qu").map((c) => c.name)).toContain("exit");
  });

  it("is case-insensitive and returns nothing on no match", () => {
    expect(filterCommands("/NE").map((c) => c.name)).toEqual(["new"]);
    expect(filterCommands("zzz")).toEqual([]);
  });
});

describe("command table integrity", () => {
  it("has unique names and aliases", () => {
    const all = COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
    expect(new Set(all).size).toBe(all.length);
  });
});
