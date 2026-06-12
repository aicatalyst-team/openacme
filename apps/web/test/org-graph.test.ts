import { describe, it, expect } from "vitest";
import { buildOrgGraph } from "@/app/teams/org-graph";
import type { AgentInfo, Team } from "@/app/teams/types";

function team(
  id: string,
  members: string[],
  manager: string | null = null,
  archived = false
): Team {
  return { id, name: id, members, manager, archived, charter: "" };
}

function agents(...ids: string[]): AgentInfo[] {
  return ids.map((id) => ({ id, name: id }));
}

describe("buildOrgGraph", () => {
  it("chains people through manager seats", () => {
    const g = buildOrgGraph(
      [
        team("exec", ["ceo", "lead"], "ceo"),
        team("eng", ["lead", "dev"], "lead"),
      ],
      agents("ceo", "lead", "dev")
    );
    expect(g.roots).toEqual(["ceo"]);
    expect(g.persons.get("lead")!.parentAgentId).toBe("ceo");
    expect(g.persons.get("dev")!.parentAgentId).toBe("lead");
    expect(g.edges).toEqual([
      { kind: "primary", managerId: "ceo", agentId: "lead", teamIds: ["exec"] },
      { kind: "primary", managerId: "lead", agentId: "dev", teamIds: ["eng"] },
    ]);
  });

  it("makes members of a managerless team roots, with no synthetic seat", () => {
    const g = buildOrgGraph([team("growth", ["a", "b"])], agents("a", "b"));
    expect(g.roots).toEqual(["a", "b"]);
    expect(g.edges).toEqual([]);
    expect(g.persons.get("a")!.seats).toEqual([
      { teamId: "growth", isManager: false },
    ]);
  });

  it("records manager seats on the person", () => {
    const g = buildOrgGraph(
      [team("eng", ["m", "x"], "m"), team("qa", ["m", "y"], "m")],
      agents("m", "x", "y")
    );
    expect(g.persons.get("m")!.seats).toEqual([
      { teamId: "eng", isManager: true },
      { teamId: "qa", isManager: true },
    ]);
    expect(g.persons.get("x")!.parentAgentId).toBe("m");
    expect(g.persons.get("y")!.parentAgentId).toBe("m");
    expect(g.roots).toEqual(["m"]);
  });

  it("picks the first reporting line as primary and keeps extras", () => {
    const make = (first: string, second: string) => [
      team(first, ["m1", "a"], "m1"),
      team(second, ["m2", "a"], "m2"),
    ];
    const g1 = buildOrgGraph(make("alpha", "beta"), agents("m1", "m2", "a"));
    expect(g1.persons.get("a")!.parentAgentId).toBe("m1");
    expect(g1.edges).toEqual([
      { kind: "primary", managerId: "m1", agentId: "a", teamIds: ["alpha"] },
      { kind: "extra", managerId: "m2", agentId: "a", teamIds: ["beta"] },
    ]);

    // Reversed team order flips the pick — input order decides.
    const g2 = buildOrgGraph(
      [team("beta", ["m2", "a"], "m2"), team("alpha", ["m1", "a"], "m1")],
      agents("m1", "m2", "a")
    );
    expect(g2.persons.get("a")!.parentAgentId).toBe("m2");
  });

  it("merges the same manager-report pair across teams into one edge", () => {
    const g = buildOrgGraph(
      [team("eng", ["m", "a"], "m"), team("qa", ["m", "a"], "m")],
      agents("m", "a")
    );
    expect(g.edges).toEqual([
      {
        kind: "primary",
        managerId: "m",
        agentId: "a",
        teamIds: ["eng", "qa"],
      },
    ]);
  });

  it("breaks a mutual-reporting cycle at the min-id person", () => {
    // a manages t1 (b reports to a); b manages t2 (a reports to b).
    const g = buildOrgGraph(
      [team("t1", ["a", "b"], "a"), team("t2", ["b", "a"], "b")],
      agents("a", "b")
    );
    expect(g.persons.get("a")!.parentAgentId).toBeNull();
    expect(g.persons.get("a")!.cycleBroken).toBe(true);
    expect(g.persons.get("b")!.parentAgentId).toBe("a");
    expect(g.roots).toEqual(["a"]);
    expect(g.edges).toEqual([
      { kind: "primary", managerId: "a", agentId: "b", teamIds: ["t1"] },
      { kind: "broken-cycle", managerId: "b", agentId: "a", teamIds: ["t2"] },
    ]);
  });

  it("breaks a 3-person cycle exactly once", () => {
    const g = buildOrgGraph(
      [
        team("t1", ["p1", "p2"], "p1"),
        team("t2", ["p2", "p3"], "p2"),
        team("t3", ["p3", "p1"], "p3"),
      ],
      agents("p1", "p2", "p3")
    );
    const broken = g.edges.filter((e) => e.kind === "broken-cycle");
    expect(broken).toHaveLength(1);
    expect(broken[0]?.agentId).toBe("p1");
    expect(g.persons.get("p1")!.cycleBroken).toBe(true);
    expect(g.roots).toEqual(["p1"]);
    expect(g.persons.get("p2")!.parentAgentId).toBe("p1");
    expect(g.persons.get("p3")!.parentAgentId).toBe("p2");
  });

  it("excludes archived teams from seats, edges, and unaffiliated", () => {
    const g = buildOrgGraph(
      [team("dead", ["m", "z"], "m", true), team("live", ["m", "c"], "m")],
      agents("m", "c", "z")
    );
    expect(g.persons.get("m")!.seats).toEqual([
      { teamId: "live", isManager: true },
    ]);
    expect(g.persons.has("z")).toBe(false);
    expect(g.unaffiliatedAgentIds).toEqual(["z"]);
    expect(g.edges).toEqual([
      { kind: "primary", managerId: "m", agentId: "c", teamIds: ["live"] },
    ]);
  });

  it("lists agents with no active seat as unaffiliated, in agents order", () => {
    const g = buildOrgGraph([team("t", ["a"], null)], agents("c", "a", "b"));
    expect(g.unaffiliatedAgentIds).toEqual(["c", "b"]);
  });

  it("keeps member ids with no matching agent as persons", () => {
    const g = buildOrgGraph(
      [team("t", ["ghost", "m"], "m")],
      agents("m")
    );
    expect(g.persons.get("ghost")!.parentAgentId).toBe("m");
    expect(g.order).toEqual(["ghost", "m"]);
    expect(g.unaffiliatedAgentIds).toEqual([]);
  });

  it("orders persons by first appearance across the team walk", () => {
    const g = buildOrgGraph(
      [team("t1", ["b", "a"], "b"), team("t2", ["c", "a"], "c")],
      agents("a", "b", "c")
    );
    expect(g.order).toEqual(["b", "a", "c"]);
  });
});
