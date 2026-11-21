import type {
  ApprovalAction,
  ApprovalDecision,
  ApprovalKind,
  ApprovalMatcher,
  ApprovalRecord,
} from "./types";

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

export function isApprovalMatcher(value: unknown): value is ApprovalMatcher {
  return value === "exact" || value === "prefix";
}

/** A saved rule matches at a word boundary; prefix never matches part of a word. */
export function approvalRuleMatches(
  rule: { match: string; matcher: ApprovalMatcher },
  command: string,
): boolean {
  const normalized = normalizeApprovalMatch(command);
  if (normalized === rule.match) return true;
  return rule.matcher === "prefix" && normalized.startsWith(`${rule.match} `);
}

export type BuiltInApprovalRule = {
  id: string;
  kind: ApprovalKind;
  label: string;
  match: string;
  matcher: ApprovalMatcher;
  /** Extra exact forms that share this rule's display label. */
  variants?: string[];
  detail: string;
};

/**
 * Commands that can destroy a disk or the system root. They are denied before
 * a saved rule is considered and cannot be removed from Settings.
 */
export const BUILT_IN_APPROVAL_RULES: BuiltInApprovalRule[] = [
  {
    id: "format",
    kind: "shell",
    label: "Format a disk",
    match: "format",
    matcher: "prefix",
    detail: "Blocks format and any arguments, such as format C: /q.",
  },
  {
    id: "diskpart",
    kind: "shell",
    label: "Partition a disk",
    match: "diskpart",
    matcher: "prefix",
    detail: "Blocks diskpart and its scripts, such as diskpart /s disk.txt.",
  },
  {
    id: "rm-root",
    kind: "shell",
    label: "Delete the system root",
    match: "rm -rf /",
    matcher: "exact",
    variants: ["rm -rf /", "rm -rf /*", "rm -rf --no-preserve-root /"],
    detail: "Blocks rm -rf /, rm -rf /*, and rm -rf --no-preserve-root /.",
  },
];

export function builtInApprovalRule(
  command: string,
  kind?: ApprovalKind,
): BuiltInApprovalRule | null {
  const normalized = normalizeApprovalMatch(command);
  for (const rule of BUILT_IN_APPROVAL_RULES) {
    if (kind && rule.kind !== kind) continue;
    const candidates = rule.variants ?? [rule.match];
    if (candidates.some((match) => approvalRuleMatches({ match, matcher: rule.matcher }, normalized))) {
      return rule;
    }
  }
  return null;
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
