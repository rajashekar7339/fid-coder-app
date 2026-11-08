export type AgentToolProfile = "all" | "browser" | "developer";

export type Agent = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  workspaceDir: string | null;
  model: string;
  toolProfile: AgentToolProfile;
  readOnly: boolean;
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

export type CreditStatus = "complete" | "partial" | "unavailable";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  modelCalls: number;
  model: string | null;
  isAuto: boolean;
  nanoAiu: number;
  creditCalls: number;
  creditStatus: CreditStatus;
};

export type Message = {
  id: string;
  agentId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  turnId?: string | null;
  usage?: TokenUsage | null;
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

export type SkillSource = "workspace" | "app" | "copilot" | "builtin";

export type SkillFile = {
  path: string;
  bytes: number;
};

export type SkillInfo = {
  id: string;
  name: string;
  description: string;
  version: string | null;
  source: SkillSource;
  chars: number;
};

export type SkillContent = SkillInfo & {
  path: string;
  body: string;
  files: SkillFile[];
};

export type SkillCatalog = {
  skills: SkillInfo[];
  warnings: string[];
};

export type SkillInstallResult =
  | { status: "installed"; skill: SkillInfo; previous: SkillInfo | null }
  | { status: "cancelled" };

export type WorkspaceRuleFile = {
  path: string;
  chars: number;
  truncated: boolean;
};

export type ContextView = {
  agentId: string;
  model: string;
  toolProfile: AgentToolProfile;
  readOnly: boolean;
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

export type ApprovalKind = "shell" | "tool";

export type ApprovalAction = "approve" | "reject" | "always-allow" | "always-deny";

export type ApprovalDecision = "allow" | "deny";

export type ApprovalSource = "user" | "rule" | "timeout" | "aborted";

export type ApprovalRequest = {
  id: string;
  agentId: string;
  agentName: string;
  turnId: string | null;
  kind: ApprovalKind;
  title: string;
  command: string;
  cwd: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
};

export type ApprovalOutcome = {
  approved: boolean;
  decision: ApprovalDecision;
  source: ApprovalSource;
  reason: string;
};

export type ApprovalRecord = {
  id: string;
  agentId: string;
  agentName: string;
  turnId: string | null;
  kind: ApprovalKind;
  command: string;
  cwd: string;
  reason: string;
  decision: "pending" | ApprovalDecision;
  source: ApprovalSource | null;
  createdAt: string;
  decidedAt: string | null;
};

export type ApprovalRule = {
  id: string;
  agentId: string;
  agentName: string;
  kind: ApprovalKind;
  decision: ApprovalDecision;
  match: string;
  cwd: string;
  createdAt: string;
};

export type ApprovalRuleInput = {
  agentId: string;
  kind: ApprovalKind;
  decision: ApprovalDecision;
  match: string;
  cwd: string;
};

export type ChatEvent =
  | { agentId: string; type: "user"; text: string }
  | { agentId: string; type: "text"; text: string }
  | { agentId: string; type: "tool-start"; toolName: string; text?: string }
  | { agentId: string; type: "tool-end"; toolName: string; ok: boolean; text?: string }
  | { agentId: string; type: "usage"; usage: TokenUsage }
  | { agentId: string; type: "approval-request"; approval: ApprovalRequest }
  | {
      agentId: string;
      type: "approval-resolved";
      approvalId: string;
      decision: ApprovalDecision;
      source: ApprovalSource;
      reason: string;
    }
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
  readOnly?: boolean;
  memoryEnabled: boolean;
};

export type WorkspaceMapView = {
  text: string;
  generatedAt: string;
  stale: boolean;
};

export type WorkspaceFilePeek = {
  path: string;
  text: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  line: number | null;
  lineEnd: number | null;
  truncated: boolean;
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
