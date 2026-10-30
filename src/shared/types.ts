export const DELETE_CONFIRM_MARKER = "DELETE_CONFIRM_REQUIRED:";

export type AgentToolProfile = "all" | "browser" | "developer";

export type Agent = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  workspaceDir: string | null;
  model: string;
  toolProfile: AgentToolProfile;
  memorySummary: string;
  memoryEnabled: boolean;
  lastActivityAt: string | null;
  nextRoutineAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CopilotModel = {
  id: string;
  name: string;
};

export type MessageRole = "user" | "assistant" | "tool";

export type Message = {
  id: string;
  agentId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type Routine = {
  id: string;
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  notify: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlanStepStatus = "pending" | "in_progress" | "done";

export type PlanStep = {
  text: string;
  status: PlanStepStatus;
};

export type PlanView = {
  agentId: string;
  turnId: string | null;
  steps: PlanStep[];
  updatedAt: string;
};

export type FileChangeKind = "create" | "update";

export type FileChangeSummary = {
  id: string;
  path: string;
  kind: FileChangeKind;
  additions: number;
  deletions: number;
  revertible: boolean;
  note: string | null;
};

export type ChangeSet = {
  turnId: string;
  startedAt: string;
  source: string;
  status: string | null;
  files: FileChangeSummary[];
};

export type FileDiff = {
  id: string;
  path: string;
  kind: FileChangeKind;
  before: string | null;
  after: string | null;
  truncated: boolean;
  revertible: boolean;
  note: string | null;
};

export type WorkspaceRuleFile = {
  path: string;
  chars: number;
  truncated: boolean;
};

export type ContextView = {
  agentId: string;
  model: string;
  toolProfile: AgentToolProfile;
  systemMessage: string;
  memorySummary: string;
  workspaceBrief: string | null;
  rules: WorkspaceRuleFile[];
  tools: string[];
  chars: {
    system: number;
    memory: number;
    brief: number;
    rules: number;
  };
};

export type ChatEvent =
  | { agentId: string; type: "user"; text: string }
  | { agentId: string; type: "text"; text: string }
  | { agentId: string; type: "tool-start"; toolName: string; text?: string }
  | { agentId: string; type: "tool-end"; toolName: string; ok: boolean; text?: string }
  | { agentId: string; type: "plan"; steps: PlanStep[]; turnId: string | null }
  | { agentId: string; type: "done"; text: string }
  | { agentId: string; type: "error"; error: string };

export type SettingsView = {
  cliFound: boolean;
  cliVersion: string | null;
  authStatus: string;
  signedIn: boolean;
  loginName: string | null;
  hasStoredToken: boolean;
  hasGithubPat: boolean;
  hasJiraToken: boolean;
  jiraSiteUrl: string;
};

export type AgentInput = {
  name: string;
  description?: string;
  systemPrompt: string;
  workspaceDir: string | null;
  model: string;
  toolProfile: AgentToolProfile;
  memoryEnabled: boolean;
};

export type BrowserPreview = {
  image: string;
  url: string;
  title: string;
};

export type RoutineInput = {
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  notify: boolean;
};

export type RoutinePatch = {
  name?: string;
  prompt?: string;
  cron?: string;
  enabled?: boolean;
  notify?: boolean;
};
