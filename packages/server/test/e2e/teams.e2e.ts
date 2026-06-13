import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startE2EServer, type E2EServer } from "./support/harness.js";
import { makeClient, waitUntil } from "./support/client.js";

/**
 * Teams + manager routing end to end: a team with a designated manager, and a
 * team-addressed task (no explicit assignee) landing on that manager via the
 * `resolveTeamManager` seam.
 */
describe("teams (e2e)", () => {
  let srv: E2EServer;
  let c: ReturnType<typeof makeClient>;

  beforeAll(async () => {
    srv = await startE2EServer();
    c = makeClient(srv.baseUrl);
    await c.createAgent("lead");
    await c.createAgent("ic");
    const res = await c.post("/api/teams", {
      id: "web-team",
      name: "Web Team",
      members: ["lead", "ic"],
      manager: "lead",
    });
    expect(res.status).toBe(201);
  });
  afterAll(async () => {
    await srv.close();
  });

  it("creates a team with a manager and lists it", async () => {
    const teams = await c.json("/api/teams");
    const team = teams.find((t: any) => t.id === "web-team");
    expect(team).toBeTruthy();
    expect(team.manager).toBe("lead");
    expect(team.members).toEqual(["lead", "ic"]);
  });

  it("routes a team-addressed task to the team's manager", async () => {
    // Created by `ic`, addressed to the team with NO assignee — the store
    // resolves the assignee to the team's manager (`lead`).
    await c.chat("ic", '[[mock:tool:task_create:{"title":"Triage inbound","team":"web-team"}]]');

    await waitUntil(async () => {
      const { tasks } = await c.json("/api/tasks");
      return tasks.some((t: any) => t.title === "Triage inbound");
    });

    const { tasks } = await c.json("/api/tasks");
    const task = tasks.find((t: any) => t.title === "Triage inbound");
    expect(task.team).toBe("web-team");
    expect(task.assignee).toBe("lead");
    expect(task.created_by).toBe("ic");
  });
});
