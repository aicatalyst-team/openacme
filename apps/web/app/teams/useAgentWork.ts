import { useMemo } from "react";
import { useHomeStream } from "../lib/useHomeStream";
import type { HomePayload } from "../lib/types";
import type { AgentLiveStatus } from "./types";

export const STATUS_DOT: Record<AgentLiveStatus, string> = {
  waiting: "bg-plot-red pulse-live",
  running: "bg-signal-blue",
  idle: "bg-ink-faint",
};

export const STATUS_TEXT: Record<AgentLiveStatus, string> = {
  waiting: "text-plot-red",
  running: "text-signal-blue",
  idle: "text-ink-soft",
};

export interface AgentWork {
  status: AgentLiveStatus;
  /** Task title from the session driving the status, if any. */
  currentTaskTitle: string | null;
  /** Non-terminal tasks bound to this agent's sessions. */
  pending: number;
  /** Most recent activity across the agent's sessions (unix-seconds). */
  lastActivity: number;
  pingMessage?: string;
}

/** Live per-agent rollup across the agent's sessions; waiting > running > idle. */
export function useAgentWork(): {
  workByAgent: Map<string, AgentWork>;
  loading: boolean;
  payload: HomePayload | null;
} {
  const { payload, loading } = useHomeStream();

  const workByAgent = useMemo(() => {
    const m = new Map<string, AgentWork>();
    if (!payload) return m;
    const buckets: Array<[AgentLiveStatus, typeof payload.idle]> = [
      ["idle", payload.idle],
      ["running", payload.running],
      ["waiting", payload.waiting],
    ];
    for (const [status, sessions] of buckets) {
      for (const s of sessions) {
        const prev = m.get(s.agentId);
        m.set(s.agentId, {
          status,
          currentTaskTitle: s.currentTaskTitle ?? prev?.currentTaskTitle ?? null,
          pending: (prev?.pending ?? 0) + s.pendingTaskCount,
          lastActivity: Math.max(prev?.lastActivity ?? 0, s.lastActivity),
          pingMessage: s.pingMessage ?? prev?.pingMessage,
        });
      }
    }
    return m;
  }, [payload]);

  return { workByAgent, loading, payload };
}
