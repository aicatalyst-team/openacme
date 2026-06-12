// Dagre layout over the derived org graph. Tree-first: only primary
// reporting edges influence positioning; extra managers and broken
// cycles are overlaid as non-layout edges.
import dagre from "@dagrejs/dagre";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { HUMAN_NODE_ID, type OrgGraph } from "./org-graph";

// Person-card geometry — must match the Tailwind sizes in org-chart.tsx
// so dagre never needs a DOM measurement pass.
export const PERSON_W = 224;
export const PERSON_H = 56;
const HUMAN_W = 140;
const HUMAN_H = 40;

export interface PersonNodeData extends Record<string, unknown> {
  agentId: string;
}

export interface TeamGroupNodeData extends Record<string, unknown> {
  teamId: string;
  label: string;
  width: number;
  height: number;
}

const GROUP_PAD_X = 14;
const GROUP_PAD_TOP = 20; // room for the legend straddling the border
const GROUP_PAD_BOTTOM = 12;

const EDGE_STROKE: Record<string, string> = {
  primary: "var(--ink-faint)",
  extra: "var(--signal-blue)",
  "broken-cycle": "var(--warn-ochre)",
};

export function layoutOrgGraph(
  graph: OrgGraph,
  teamNames: Map<string, string>
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  // Spacing leaves clear air between team underlays: sibling gap must
  // exceed two frames' side padding, rank gap two frames' top+bottom.
  g.setGraph({
    rankdir: "TB",
    ranksep: 80,
    nodesep: 48,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Agents in no team still work for the human — direct reports, not a
  // parked "unaffiliated" strip.
  const personIds = [...graph.order, ...graph.unaffiliatedAgentIds];
  const humanChildren = [...graph.roots, ...graph.unaffiliatedAgentIds];

  g.setNode(HUMAN_NODE_ID, { width: HUMAN_W, height: HUMAN_H });
  for (const id of personIds) {
    g.setNode(id, { width: PERSON_W, height: PERSON_H });
  }
  for (const child of humanChildren) g.setEdge(HUMAN_NODE_ID, child);
  for (const e of graph.edges) {
    if (e.kind === "primary") g.setEdge(e.managerId, e.agentId);
  }

  dagre.layout(g);

  const place = (id: string) => {
    const n = g.node(id);
    return { x: n.x - n.width / 2, y: n.y - n.height / 2 };
  };

  const personNodes: Node[] = personIds.map((id) => ({
    id,
    type: "person",
    position: place(id),
    data: { agentId: id } satisfies PersonNodeData,
  }));
  const positionById = new Map(personNodes.map((n) => [n.id, n.position]));

  // Team underlays: every person has one "home" team — the team their
  // primary reporting line runs through (first seat when they have no
  // manager). Boxing homes never nests: a manager's home is the team
  // they report THROUGH, so they sit in the upper team's box with a
  // line down into the box of the team they run.
  const homeTeam = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.kind === "primary") homeTeam.set(e.agentId, e.teamIds[0]!);
  }
  for (const p of graph.persons.values()) {
    if (!homeTeam.has(p.agentId) && p.seats.length > 0) {
      homeTeam.set(p.agentId, p.seats[0]!.teamId);
    }
  }
  const groupNodes: Node[] = [];
  const byTeam = new Map<string, string[]>();
  for (const [agentId, teamId] of homeTeam) {
    const list = byTeam.get(teamId);
    if (list) list.push(agentId);
    else byTeam.set(teamId, [agentId]);
  }
  for (const [teamId, agentIds] of byTeam) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of agentIds) {
      const p = positionById.get(id)!;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + PERSON_W);
      y1 = Math.max(y1, p.y + PERSON_H);
    }
    groupNodes.push({
      id: `team:${teamId}`,
      type: "teamGroup",
      position: { x: x0 - GROUP_PAD_X, y: y0 - GROUP_PAD_TOP },
      data: {
        teamId,
        label: teamNames.get(teamId) ?? teamId,
        width: x1 - x0 + 2 * GROUP_PAD_X,
        height: y1 - y0 + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
      } satisfies TeamGroupNodeData,
      zIndex: -1,
      selectable: false,
      draggable: false,
    });
  }

  const nodes: Node[] = [
    ...groupNodes,
    {
      id: HUMAN_NODE_ID,
      type: "human",
      position: place(HUMAN_NODE_ID),
      data: {},
    },
    ...personNodes,
  ];

  // Disambiguating labels: once a manager runs more than one team, the
  // line alone no longer says which team a report sits in.
  const managedCount = new Map<string, number>();
  for (const p of graph.persons.values()) {
    for (const s of p.seats) {
      if (s.isManager)
        managedCount.set(p.agentId, (managedCount.get(p.agentId) ?? 0) + 1);
    }
  }
  const teamName = (id: string) => teamNames.get(id) ?? id;

  const edges: Edge[] = [];
  for (const child of humanChildren) {
    edges.push({
      id: `e-h:${child}`,
      source: HUMAN_NODE_ID,
      target: child,
      type: "smoothstep",
      style: { stroke: "var(--ink-faint)", strokeWidth: 1 },
    });
  }

  // Primary reporting renders as ONE line per managed frame — person to
  // box, unit-style — instead of a fan of person-to-person lines.
  // Membership inside the frame needs no lines; containment says it.
  // Skipped when the manager sits inside that same frame (root manager
  // of their own team): a self-loop would say nothing.
  const frameEdges = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind !== "primary") continue;
    const frame = homeTeam.get(e.agentId);
    if (!frame || homeTeam.get(e.managerId) === frame) continue;
    frameEdges.add(`${e.managerId} ${frame}`);
  }
  for (const key of frameEdges) {
    const [managerId, teamId] = key.split(" ") as [string, string];
    edges.push({
      id: `e-t:${managerId}:${teamId}`,
      source: managerId,
      target: `team:${teamId}`,
      type: "smoothstep",
      style: { stroke: "var(--ink-faint)", strokeWidth: 1 },
    });
  }

  for (const e of graph.edges) {
    if (e.kind === "primary") continue;
    const label =
      (managedCount.get(e.managerId) ?? 0) > 1 || e.teamIds.length > 1
        ? e.teamIds.map(teamName).join(", ")
        : undefined;
    edges.push({
      id: `e-r:${e.managerId}:${e.agentId}`,
      source: e.managerId,
      target: e.agentId,
      type: "default",
      label,
      labelStyle: {
        fill: "var(--ink-faint)",
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
      },
      labelBgStyle: { fill: "var(--paper)" },
      style: {
        stroke: EDGE_STROKE[e.kind],
        strokeWidth: 1.25,
        strokeDasharray: "4 3",
      },
      // Frame edges read top-down; these curving person-to-person
      // edges need an explicit manager → report direction.
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: EDGE_STROKE[e.kind],
        width: 14,
        height: 14,
      },
    });
  }

  return { nodes, edges };
}
