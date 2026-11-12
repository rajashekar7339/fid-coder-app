import type { HistoryPort } from "../shared/history";
import type { RoutineDraft } from "../shared/routine-schedule";
import type { ApprovalKind, ApprovalOutcome, Routine, SkillFile } from "../shared/types";

export interface BrowserControl {
  navigate(agentId: string, url: string): Promise<string>;
  snapshot(agentId: string): Promise<string>;
  click(agentId: string, selector: string): Promise<string>;
  type(agentId: string, selector: string, text: string, submit: boolean): Promise<string>;
}

export const MAX_CHECKPOINT_BYTES = 2_000_000;

export type RoutinePort = {
  list(agentId: string): Routine[];
  create(agentId: string, draft: RoutineDraft): Routine;
  remove(agentId: string, id: string): Routine;
};

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

export type SkillActivation = {
  id: string;
  name: string;
  description: string;
  version: string | null;
  body: string;
  dir: string;
  files: SkillFile[];
};

export type ToolContext = {
  agentId: string;
  workspaceDir: string | null;
  skillDir?: string;
  skills?: SkillActivation[];
  onSkillUsed?: (id: string) => void;
  writeRoot?: string;
  model?: string;
  turnId?: string;
  browser: BrowserControl;
  githubPat: string | null;
  jiraToken: string | null;
  jiraSite: string | null;
  explore?: (question: string) => Promise<string>;
  review?: (target: string) => Promise<string>;
  checkpoint?: CheckpointPort;
  requestApproval?: (request: ApprovalToolRequest) => Promise<ApprovalOutcome>;
  history?: HistoryPort;
  routines?: RoutinePort;
};

export type AppTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: unknown, ctx: ToolContext) => Promise<string>;
};
