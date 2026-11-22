export type NamedRow = {
  agentId: string;
  agentName: string;
  createdAt?: string;
};

export type AgentGroup<T> = {
  agentId: string;
  agentName: string;
  count: number;
  items: T[];
};

export type RoutineBoardRow = {
  agentId: string;
  agentName: string;
  name: string;
  enabled: boolean;
};

function groupSorted<T extends NamedRow>(sorted: T[]): AgentGroup<T>[] {
  const groups: AgentGroup<T>[] = [];
  for (const item of sorted) {
    const group = groups.find((entry) => entry.agentId === item.agentId);
    if (group) {
      group.items.push(item);
      group.count += 1;
      continue;
    }
    groups.push({ agentId: item.agentId, agentName: item.agentName, count: 1, items: [item] });
  }
  return groups;
}

/** Newest row first. The group order follows the newest row in each group. */
export function groupByAgent<T extends NamedRow>(items: T[]): AgentGroup<T>[] {
  return groupSorted(
    [...items].sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "")),
  );
}

/** Agent name, then enabled routines, then routine name. */
export function groupRoutineBoard<T extends RoutineBoardRow>(items: T[]): AgentGroup<T>[] {
  return groupSorted(
    [...items].sort((left, right) => {
      const byAgent = left.agentName.localeCompare(right.agentName, undefined, { sensitivity: "base" });
      if (byAgent !== 0) return byAgent;
      if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    }),
  );
}
