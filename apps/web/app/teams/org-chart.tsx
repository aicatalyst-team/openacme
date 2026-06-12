import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Maximize, Minus, Plus, User } from "lucide-react";
import {
  Handle,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { AgentAvatar } from "@/app/components/ui/agent-avatar";
import { AgentRef } from "@/app/components/ui/agent-ref";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/utils";
import { ManagerBadge } from "./manager-badge";
import { buildOrgGraph, type OrgGraph } from "./org-graph";
import {
  layoutOrgGraph,
  type PersonNodeData,
  type TeamGroupNodeData,
} from "./org-layout";
import { STATUS_DOT, useAgentWork, type AgentWork } from "./useAgentWork";
import type { AgentInfo, Team } from "./types";

// Status and lookups flow through context, not node `data`, so live SSE
// updates re-render card internals without rebuilding/relaying the graph.
interface OrgChartContextValue {
  agentById: Map<string, AgentInfo>;
  teamById: Map<string, Team>;
  workByAgent: Map<string, AgentWork>;
  persons: OrgGraph["persons"];
  /** Members of the team selected in the URL — highlighted. */
  selectedAgentIds: Set<string>;
  /** Teammates of the hovered person — affiliation highlight. */
  affiliatedIds: Set<string> | null;
  setHoveredId: (agentId: string | null) => void;
}

const OrgChartContext = createContext<OrgChartContextValue | null>(null);

function useOrgChartContext(): OrgChartContextValue {
  const ctx = useContext(OrgChartContext);
  if (!ctx) throw new Error("OrgChartContext missing");
  return ctx;
}

/** One agent — the chart's atom; each appears exactly once. The second
 *  line states their org position: the teams they manage, then the
 *  teams they sit in. Role text lives in the tooltip. */
function PersonNode({ data }: NodeProps & { data: PersonNodeData }) {
  const {
    agentById,
    teamById,
    workByAgent,
    persons,
    selectedAgentIds,
    affiliatedIds,
    setHoveredId,
  } = useOrgChartContext();
  const { agentId } = data;
  const agent = agentById.get(agentId);
  const seats = persons.get(agentId)?.seats ?? [];
  const teamName = (id: string) => teamById.get(id)?.name ?? id;

  const managed = seats.filter((s) => s.isManager).map((s) => s.teamId);
  const memberOf = seats.filter((s) => !s.isManager).map((s) => s.teamId);
  // Managers get the verb; members sit inside their team's frame, so
  // the role is the more useful line. Full seats live in the tooltip.
  const detailLine =
    managed.length > 0
      ? `Manages ${managed.map(teamName).join(", ")}`
      : (agent?.role ?? "");
  const tooltip = [
    agent?.role,
    managed.length > 0 && `Manages: ${managed.map(teamName).join(", ")}`,
    memberOf.length > 0 && `Member of: ${memberOf.map(teamName).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const status = agent ? (workByAgent.get(agentId)?.status ?? "idle") : null;
  const isManager = managed.length > 0;
  const selected = selectedAgentIds.has(agentId);
  const affiliated = affiliatedIds?.has(agentId) ?? false;

  return (
    <div
      className={cn(
        "flex h-[56px] w-[224px] items-center gap-2.5 border px-3 transition-colors",
        affiliated ? "bg-paper-sunk" : "bg-paper",
        selected
          ? "border-ink"
          : "border-paper-rule hover:border-ink-faint"
      )}
      title={tooltip || undefined}
      onMouseEnter={() => setHoveredId(agentId)}
      onMouseLeave={() => setHoveredId(null)}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <AgentAvatar avatar={agent?.avatar} size="xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {agent ? (
            <AgentRef
              id={agentId}
              label={agent.name}
              className="min-w-0 truncate text-[13px] font-medium leading-tight text-ink"
            />
          ) : (
            <span className="min-w-0 truncate font-mono text-[11px] text-ink-faint">
              {agentId} — not found
            </span>
          )}
          {isManager && <ManagerBadge />}
        </div>
        {detailLine && (
          <div
            className={cn(
              "truncate text-[10px] leading-tight",
              isManager ? "text-ink-soft" : "text-ink-faint"
            )}
          >
            {detailLine}
          </div>
        )}
      </div>
      {status && (
        <span
          className={cn("status-dot shrink-0", STATUS_DOT[status])}
          title={status}
        />
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

function HumanNode() {
  return (
    <div className="flex h-[40px] w-[140px] items-center justify-center gap-2 border border-ink bg-ink">
      <User className="size-3.5 text-paper" aria-hidden />
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-paper">
        Human
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

/** Dashed underlay behind a team's home members — affiliation made
 *  visible without containment (multi-team agents live in their primary
 *  team's box; the rest shows on hover and in the seat line). */
function TeamGroupNode({ data }: NodeProps & { data: TeamGroupNodeData }) {
  return (
    <div
      className="relative border border-dashed border-ink-faint/60"
      style={{ width: data.width, height: data.height }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="absolute -top-[8px] left-2 max-w-[85%] truncate bg-paper px-1.5 font-mono text-[10px] uppercase leading-[16px] tracking-[0.08em] text-ink-soft">
        {data.label}
      </span>
    </div>
  );
}

const NODE_TYPES = {
  human: HumanNode,
  person: PersonNode,
  teamGroup: TeamGroupNode,
};

function ChartControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <div className="flex flex-col gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Zoom in"
        onClick={() => void zoomIn({ duration: 150 })}
      >
        <Plus className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Zoom out"
        onClick={() => void zoomOut({ duration: 150 })}
      >
        <Minus className="size-4" />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Fit chart"
        onClick={() =>
          void fitView({ padding: 0.15, maxZoom: 1, duration: 200 })
        }
      >
        <Maximize className="size-4" />
      </Button>
    </div>
  );
}

function Legend() {
  const dashed = (stroke: string) => (
    <svg className="h-px w-5 shrink-0" aria-hidden>
      <line
        x1="0"
        y1="0.5"
        x2="20"
        y2="0.5"
        stroke={stroke}
        strokeDasharray="4 3"
      />
    </svg>
  );
  return (
    <div className="flex flex-col gap-1 border border-paper-rule bg-paper px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
      <span className="flex items-center gap-2">
        <span className="inline-block h-px w-5 shrink-0 bg-ink-faint" />
        reports to
      </span>
      <span className="flex items-center gap-2">
        {dashed("var(--signal-blue)")} also reports to
      </span>
      <span className="flex items-center gap-2">
        {dashed("var(--warn-ochre)")} cycle (broken for layout)
      </span>
    </div>
  );
}

function OrgChartInner({
  teams,
  agents,
  selectedId,
}: {
  teams: Team[];
  agents: AgentInfo[];
  selectedId: string | null;
}) {
  const { workByAgent } = useAgentWork();
  const { fitView } = useReactFlow();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const graph = useMemo(() => buildOrgGraph(teams, agents), [teams, agents]);
  const { nodes, edges } = useMemo(
    () => layoutOrgGraph(graph, new Map(teams.map((t) => [t.id, t.name]))),
    [graph, teams]
  );

  const selectedTeam = selectedId
    ? (teams.find((t) => t.id === selectedId && !t.archived) ?? null)
    : null;

  const ctx = useMemo<OrgChartContextValue>(() => {
    let affiliatedIds: Set<string> | null = null;
    if (hoveredId) {
      affiliatedIds = new Set([hoveredId]);
      const seats = graph.persons.get(hoveredId)?.seats ?? [];
      for (const s of seats) {
        for (const m of teams.find((t) => t.id === s.teamId)?.members ?? []) {
          affiliatedIds.add(m);
        }
      }
    }
    return {
      agentById: new Map(agents.map((a) => [a.id, a])),
      teamById: new Map(teams.map((t) => [t.id, t])),
      workByAgent,
      persons: graph.persons,
      selectedAgentIds: new Set(selectedTeam?.members ?? []),
      affiliatedIds,
      setHoveredId,
    };
  }, [agents, teams, workByAgent, graph, selectedTeam, hoveredId]);

  // React Flow owns the initial whole-graph fit (`fitView` prop), which
  // it applies a tick after onInit — an immediate selection fit gets
  // overridden by it. Deferring briefly makes the selection fit a
  // second step: whole graph first, then an animated zoom to the team.
  const memberKey = selectedTeam?.members.join(" ") ?? "";
  useEffect(() => {
    if (!ready || !memberKey) return;
    const timer = setTimeout(() => {
      void fitView({
        nodes: memberKey.split(" ").map((id) => ({ id })),
        maxZoom: 1,
        padding: 0.4,
        duration: 300,
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [memberKey, ready, fitView]);

  return (
    <OrgChartContext.Provider value={ctx}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        minZoom={0.08}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        onInit={() => setReady(true)}
        className="org-chart"
      >
        <Panel position="top-right">
          <ChartControls />
        </Panel>
        <Panel position="bottom-left" className="hidden md:block">
          <Legend />
        </Panel>
      </ReactFlow>
    </OrgChartContext.Provider>
  );
}

/** Derived org chart of people: every agent appears once; reporting
 *  lines come from team manager seats. Pure visualization — agents
 *  never see this structure. */
export function OrgChart(props: {
  teams: Team[];
  agents: AgentInfo[];
  selectedId: string | null;
}) {
  return (
    <ReactFlowProvider>
      <OrgChartInner {...props} />
    </ReactFlowProvider>
  );
}
