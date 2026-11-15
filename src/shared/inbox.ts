import type { ApprovalRequest } from "./types";

export type InboxKind = "approval" | "routine" | "turn";

export type StoredInboxRow = {
  id: string;
  agentId: string;
  agentName: string;
  kind: "routine" | "turn";
  title: string;
  body: string;
  createdAt: string;
  snoozeUntil: string | null;
};

export type InboxItem = {
  id: string;
  agentId: string;
  agentName: string;
  kind: InboxKind;
  title: string;
  body: string;
  createdAt: string;
  snoozeable: boolean;
};

export type InboxView = {
  items: InboxItem[];
  unread: number;
};

export function assertInboxAction(id: string): void {
  if (id.startsWith("approval:")) throw new Error("An approval stays until you answer it.");
}

export function inboxRowVisible(row: { snoozeUntil: string | null }, now: number): boolean {
  if (!row.snoozeUntil) return true;
  const until = Date.parse(row.snoozeUntil);
  return !Number.isFinite(until) || until <= now;
}

export function buildInbox(rows: StoredInboxRow[], approvals: ApprovalRequest[], now: number): InboxView {
  const approvalItems: InboxItem[] = approvals
    .map((approval) => ({
      id: `approval:${approval.id}`,
      agentId: approval.agentId,
      agentName: approval.agentName,
      kind: "approval" as const,
      title: approval.title,
      body: approval.reason,
      createdAt: approval.createdAt,
      snoozeable: false,
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const rest: InboxItem[] = rows
    .filter((row) => inboxRowVisible(row, now))
    .map((row) => ({
      id: row.id,
      agentId: row.agentId,
      agentName: row.agentName,
      kind: row.kind,
      title: row.title,
      body: row.body,
      createdAt: row.createdAt,
      snoozeable: true,
    }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const items = [...approvalItems, ...rest];
  return { items, unread: items.length };
}
