import type { Citation } from "./citations";
import type { ConfluenceMode } from "./confluence";

export type AgentToolProfile = "all" | "browser" | "developer" | "datadog";

export type ProviderId = "copilot" | "deepseek";

export type Agent = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  workspaceDir: string | null;
  provider: ProviderId;
  model: string;
  toolProfile: AgentToolProfile;
  readOnly: boolean;
  memorySummary: string;
  memoryEnabled: boolean;
  pinned: boolean;
  archived: boolean;
  lastActivityAt: string | null;
  nextRoutineAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AgentPlacement = {
  pinned?: boolean;
  archived?: boolean;
};

export type CopilotModel = {
  id: string;
  name: string;
  provider?: ProviderId;
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
  provider?: ProviderId;
  isAuto: boolean;
  nanoAiu: number;
  creditCalls: number;
  creditStatus: CreditStatus;
};

export type AttachmentKind = "selection" | "workspace" | "upload";

export type MessageAttachment = {
  kind: AttachmentKind;
  path: string;
  name: string;
  startLine?: number;
  endLine?: number;
};

export type AttachmentPick = {
  attachments: MessageAttachment[];
  errors: string[];
};

export type Message = {
  id: string;
  agentId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  turnId?: string | null;
  turnSource?: string | null;
  turnStartedAt?: string | null;
  turnEndedAt?: string | null;
  usage?: TokenUsage | null;
  attachments?: MessageAttachment[] | null;
};

/**
 * A message waiting for the running turn. `id` is only the queue entry.
 * When it starts, it goes through the normal runTurn path and becomes a
 * stored Message with its own id and turn. That keeps the future
 * edit/delete-message work on one message model.
 */
export type QueuedMessage = {
  id: string;
  agentId: string;
  text: string;
  attachments: MessageAttachment[];
  createdAt: string;
};

export type Fact = {
  id: string;
  agentId: string | null;
  content: string;
  source: "user";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type FactInput = {
  agentId: string;
  content: string;
  shared: boolean;
  enabled?: boolean;
};

export type FactPatch = {
  content?: string;
  enabled?: boolean;
};

export type RoutineOverview = Routine & {
  agentName: string;
};

export type Routine = {
  id: string;
  agentId: string;
  name: string;
  prompt: string;
  cron: string;
  once: boolean;
  runAt: string | null;
  enabled: boolean;
  notify: boolean;
  readOnly: boolean;
  consecutiveFailures: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RoutineRunTrigger = "schedule" | "manual";

export type RoutineRun = {
  id: string;
  routineId: string;
  agentId: string;
  routineName: string;
  trigger: RoutineRunTrigger;
  readOnly: boolean;
  status: string;
  startedAt: string;
  endedAt: string | null;
  turnId: string | null;
  output: string | null;
  error: string | null;
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

export type FileChangeMatch = {
  turnId: string;
  file: FileChangeSummary;
};

export type ChangesOpenRequest = {
  turnId?: string;
  fileId?: string;
  path?: string;
  line?: number | null;
  endLine?: number | null;
  related?: Citation[];
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

export type ApprovalMatcher = "exact" | "prefix";

export type ApprovalRule = {
  id: string;
  agentId: string | null;
  agentName: string;
  kind: ApprovalKind;
  decision: ApprovalDecision;
  match: string;
  matcher: ApprovalMatcher;
  cwd: string;
  createdAt: string;
};

export type ApprovalRuleInput = {
  agentId: string | null;
  kind: ApprovalKind;
  decision: ApprovalDecision;
  match: string;
  matcher: ApprovalMatcher;
  cwd: string;
};

export type QuestionSource = "user" | "timeout" | "aborted";

export type QuestionVia = "choice" | "other";

export type QuestionRequest = {
  id: string;
  agentId: string;
  agentName: string;
  question: string;
  choices: string[];
  createdAt: string;
  expiresAt: string;
};

export type QuestionReply =
  | { kind: "choice"; index: number }
  | { kind: "other"; text: string }
  | { kind: "skip" };

export type QuestionOutcome = {
  answered: boolean;
  source: QuestionSource;
  text: string | null;
  via: QuestionVia | null;
};

export type BrowserHandoffSource = "user" | "timeout" | "aborted";

export type BrowserHandoffRequest = {
  id: string;
  agentId: string;
  agentName: string;
  reason: string;
  takenOver: boolean;
  createdAt: string;
  expiresAt: string;
};

export type BrowserHandoffOutcome = {
  done: boolean;
  source: BrowserHandoffSource;
};

export type SkillSaveSource = "user" | "timeout" | "aborted";

export type SkillSaveRequest = {
  id: string;
  agentId: string;
  agentName: string;
  skillId: string;
  name: string;
  description: string;
  steps: string;
  replaces: boolean;
  createdAt: string;
  expiresAt: string;
};

export type SkillSaveOutcome = {
  saved: boolean;
  source: SkillSaveSource;
  skillId: string;
};

export type ChatEvent =
  | {
      agentId: string;
      type: "user";
      text: string;
      messageId?: string;
      queuedId?: string;
    }
  | { agentId: string; type: "queue"; queue: QueuedMessage[] }
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
  | { agentId: string; type: "question-request"; question: QuestionRequest }
  | {
      agentId: string;
      type: "question-resolved";
      questionId: string;
      source: QuestionSource;
    }
  | { agentId: string; type: "handoff-request"; handoff: BrowserHandoffRequest }
  | { agentId: string; type: "handoff-updated"; handoff: BrowserHandoffRequest }
  | {
      agentId: string;
      type: "handoff-resolved";
      handoffId: string;
      source: BrowserHandoffSource;
    }
  | { agentId: string; type: "skill-save-request"; request: SkillSaveRequest }
  | {
      agentId: string;
      type: "skill-save-resolved";
      requestId: string;
      source: SkillSaveSource;
      saved: boolean;
    }
  | { agentId: string; type: "done"; text: string }
  | { agentId: string; type: "error"; error: string; aborted?: boolean };

export type SettingsView = {
  cliFound: boolean;
  cliVersion: string | null;
  authStatus: string;
  signedIn: boolean;
  loginName: string | null;
  hasStoredToken: boolean;
  hasGithubPat: boolean;
  hasDeepseekKey: boolean;
  deepseekKeySource: "saved" | "environment" | null;
  hasJiraToken: boolean;
  jiraSiteUrl: string;
  hasConfluenceToken: boolean;
  confluenceSiteUrl: string;
  confluenceEmail: string;
  confluenceMode: ConfluenceMode;
  datadogUrl: string;
  routinesPaused: boolean;
};

export type ConfluenceSettingsInput = {
  siteUrl: string;
  email: string;
  mode: ConfluenceMode;
};

export type DatadogSettingsInput = {
  url: string;
};

export type AgentInput = {
  name: string;
  description?: string;
  systemPrompt: string;
  workspaceDir: string | null;
  provider?: ProviderId;
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

export type WorkspaceImagePeek = {
  path: string;
  mime: string;
  dataUrl: string;
  bytes: number;
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
};

export type WorkspaceDirectory = {
  entries: WorkspaceEntry[];
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
  once: boolean;
  runAt: string | null;
  enabled: boolean;
  notify: boolean;
  readOnly?: boolean;
};

export type RoutinePatch = {
  name?: string;
  prompt?: string;
  cron?: string;
  once?: boolean;
  runAt?: string | null;
  enabled?: boolean;
  notify?: boolean;
  readOnly?: boolean;
};
