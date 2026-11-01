import type { HistoryPort } from "../shared/history";
import type { ApprovalKind, ApprovalOutcome, PlanStep } from "../shared/types";

export interface BrowserControl {
  navigate(agentId: string, url: string): Promise<string>;
  snapshot(agentId: string): Promise<string>;
  click(agentId: string, selector: string): Promise<string>;
  type(agentId: string, selector: string, text: string, submit: boolean): Promise<string>;
}

export const MAX_CHECKPOINT_BYTES = 2_000_000;

export type CheckpointPort = {
  capture(file: string, previous: Buffer | null, existed?: boolean): void;
};

export type ApprovalToolRequest = {
  kind: ApprovalKind;
  title: string;
  command: string;
  cwd: string;
  reason: string;
};

export type ToolContext = {
  agentId: string;
  workspaceDir: string | null;
  model?: string;
  turnId?: string;
  browser: BrowserControl;
  githubPat: string | null;
  jiraToken: string | null;
  jiraSite: string | null;
  explore?: (question: string) => Promise<string>;
  checkpoint?: CheckpointPort;
  onPlan?: (steps: PlanStep[]) => void;
  requestApproval?: (request: ApprovalToolRequest) => Promise<ApprovalOutcome>;
  history?: HistoryPort;
};

export type AppTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: unknown, ctx: ToolContext) => Promise<string>;
};
