import type { ApprovalAction, ApprovalDecision, ApprovalRecord } from "./types";

const ACTIONS: ApprovalAction[] = ["approve", "reject", "always-allow", "always-deny"];

export function isApprovalAction(value: unknown): value is ApprovalAction {
  return typeof value === "string" && ACTIONS.includes(value as ApprovalAction);
}

export function approvalActionDecision(action: ApprovalAction): ApprovalDecision {
  return action === "approve" || action === "always-allow" ? "allow" : "deny";
}

export function approvalActionRemembers(action: ApprovalAction): boolean {
  return action === "always-allow" || action === "always-deny";
}

export function normalizeApprovalMatch(command: string): string {
  return command.trim().replace(/\s+/g, " ").toLowerCase();
}

export function approvalRecordLabel(record: Pick<ApprovalRecord, "decision" | "source">): string {
  if (record.decision === "allow") return record.source === "rule" ? "Allowed by rule" : "Allowed";
  if (record.decision === "deny") {
    if (record.source === "timeout") return "Timed out";
    if (record.source === "aborted") return "Stopped";
    if (record.source === "rule") return "Denied by rule";
    return "Rejected";
  }
  return "Waiting";
}
