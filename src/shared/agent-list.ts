import type { Agent, AgentPlacement } from "./types";

function activityMs(agent: Agent): number {
  const parsed = Date.parse(agent.lastActivityAt ?? agent.updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function compareAgents(a: Agent, b: Agent): number {
  if (a.archived !== b.archived) return a.archived ? 1 : -1;
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const byActivity = activityMs(b) - activityMs(a);
  if (byActivity !== 0) return byActivity;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

export function arrangeAgentList(agents: Agent[], query: string): { listed: Agent[]; archived: Agent[] } {
  const sorted = [...agents].sort(compareAgents);
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return {
      listed: sorted.filter((agent) => !agent.archived),
      archived: sorted.filter((agent) => agent.archived),
    };
  }
  return {
    listed: sorted.filter((agent) => `${agent.name} ${agent.description}`.toLowerCase().includes(needle)),
    archived: [],
  };
}

export function parseAgentPlacement(value: unknown): AgentPlacement {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing placement");
  const record = value as Record<string, unknown>;
  const placement: AgentPlacement = {};
  if ("pinned" in record) {
    if (typeof record.pinned !== "boolean") throw new Error("Pinned must be true or false");
    placement.pinned = record.pinned;
  }
  if ("archived" in record) {
    if (typeof record.archived !== "boolean") throw new Error("Archived must be true or false");
    placement.archived = record.archived;
  }
  if (placement.pinned === undefined && placement.archived === undefined) {
    throw new Error("Choose pin or archive");
  }
  return placement;
}
