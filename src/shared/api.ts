import type { SkillDraftInput } from "./skill-draft";
import type {
  Fact,
  FactInput,
  FactPatch,
  Agent,
  AgentInput,
  AgentPlacement,
  ApprovalAction,
  ApprovalRecord,
  ApprovalRequest,
  ApprovalRule,
  ApprovalRuleInput,
  BrowserHandoffRequest,
  QuestionReply,
  QuestionRequest,
  SkillSaveRequest,
  AttachmentPick,
  BrowserPreview,
  ChangeSet,
  ChatEvent,
  ConfluenceSettingsInput,
  DatadogSettingsInput,
  ContextView,
  CopilotModel,
  FileDiff,
  Message,
  MessageAttachment,
  QueuedMessage,
  Routine,
  RoutineInput,
  RoutineOverview,
  RoutinePatch,
  RoutineRun,
  SettingsView,
  SkillCatalog,
  SkillContent,
  SkillInstallResult,
  SkillSource,
  WorkspaceDirectory,
  WorkspaceFilePeek,
  WorkspaceImagePeek,
  WorkspaceMapView,
  WorkspaceRuleFile,
} from "./types";
import type { AppPresence } from "./app-settings";
import type { InboxView } from "./inbox";
import type { CopilotUsageResult } from "./copilot-usage";
import type { EnhanceResult } from "./enhance-prompt";

export interface FidApi {
  agents: {
    list: () => Promise<Agent[]>;
    create: (input: AgentInput) => Promise<Agent>;
    update: (id: string, input: AgentInput) => Promise<Agent>;
    clearMemory: (id: string) => Promise<Agent>;
    delete: (id: string) => Promise<void>;
    place: (id: string, placement: AgentPlacement) => Promise<Agent>;
  };
  facts: {
    list: (agentId: string) => Promise<Fact[]>;
    create: (input: FactInput) => Promise<Fact>;
    update: (id: string, patch: FactPatch) => Promise<Fact>;
    delete: (id: string) => Promise<Fact>;
  };
  messages: {
    list: (agentId: string) => Promise<Message[]>;
  };
  chat: {
    send: (agentId: string, text: string, attachments?: MessageAttachment[]) => Promise<void>;
    enqueue: (
      agentId: string,
      text: string,
      attachments?: MessageAttachment[],
    ) => Promise<QueuedMessage[]>;
    queue: (agentId: string) => Promise<QueuedMessage[]>;
    updateQueued: (
      agentId: string,
      id: string,
      text: string,
    ) => Promise<QueuedMessage[]>;
    removeQueued: (agentId: string, id: string) => Promise<QueuedMessage[]>;
    clearQueue: (agentId: string) => Promise<QueuedMessage[]>;
    forceSend: (agentId: string, text: string, attachments?: MessageAttachment[]) => Promise<void>;
    forceQueued: (agentId: string, id: string) => Promise<void>;
    editMessage: (agentId: string, messageId: string, text: string) => Promise<Agent>;
    deleteMessage: (agentId: string, messageId: string) => Promise<Agent>;
    running: (agentId: string) => Promise<boolean>;
    runningAll: () => Promise<string[]>;
    abort: (agentId: string) => Promise<void>;
    enhance: (agentId: string, text: string) => Promise<EnhanceResult>;
    onEvent: (callback: (event: ChatEvent) => void) => number;
    offEvent: (id: number) => void;
  };
  questions: {
    answer: (questionId: string, reply: QuestionReply) => Promise<boolean>;
    pending: (agentId?: string) => Promise<QuestionRequest[]>;
  };
  handoffs: {
    done: (handoffId: string) => Promise<boolean>;
    takeover: (handoffId: string) => Promise<boolean>;
    pending: (agentId?: string) => Promise<BrowserHandoffRequest[]>;
  };
  skillSaves: {
    decide: (requestId: string, allow: boolean, draft?: SkillDraftInput) => Promise<boolean>;
    pending: (agentId?: string) => Promise<SkillSaveRequest[]>;
  };
  approvals: {
    decide: (approvalId: string, action: ApprovalAction) => Promise<boolean>;
    pending: (agentId?: string) => Promise<ApprovalRequest[]>;
    history: (agentId: string, limit?: number) => Promise<ApprovalRecord[]>;
    rules: (agentId?: string) => Promise<ApprovalRule[]>;
    createRule: (input: ApprovalRuleInput) => Promise<ApprovalRule>;
    updateRule: (id: string, input: ApprovalRuleInput) => Promise<ApprovalRule>;
    deleteRule: (id: string) => Promise<void>;
  };
  browser: {
    preview: (agentId: string) => Promise<BrowserPreview | null>;
    focus: (agentId: string) => Promise<boolean>;
  };
  changes: {
    latest: (agentId: string) => Promise<ChangeSet | null>;
    list: (agentId: string, limit?: number) => Promise<ChangeSet[]>;
    diff: (changeId: string) => Promise<FileDiff>;
    revert: (changeId: string) => Promise<void>;
    revertTurn: (turnId: string) => Promise<void>;
  };
  context: {
    preview: (agentId: string) => Promise<ContextView>;
  };
  workspace: {
    rules: (agentId: string) => Promise<WorkspaceRuleFile[]>;
    createRules: (agentId: string) => Promise<WorkspaceRuleFile[]>;
    openRule: (agentId: string, path: string) => Promise<void>;
    map: (agentId: string) => Promise<WorkspaceMapView | null>;
    buildMap: (agentId: string) => Promise<WorkspaceMapView>;
    list: (agentId: string, path?: string) => Promise<WorkspaceDirectory>;
    file: (
      agentId: string,
      path: string,
      line?: number | null,
      endLine?: number | null,
      startLine?: number | null,
      limit?: number | null,
    ) => Promise<WorkspaceFilePeek>;
    image: (agentId: string, path: string) => Promise<WorkspaceImagePeek>;
  };
  routines: {
    list: (agentId: string) => Promise<Routine[]>;
    listAll: () => Promise<RoutineOverview[]>;
    create: (input: RoutineInput) => Promise<Routine>;
    update: (id: string, patch: RoutinePatch) => Promise<Routine>;
    delete: (id: string) => Promise<void>;
    run: (id: string) => Promise<Routine>;
    history: (agentId: string) => Promise<RoutineRun[]>;
    stop: (runId: string) => Promise<void>;
  };
  app: {
    presence: () => Promise<AppPresence>;
    setPresence: (patch: Partial<AppPresence>) => Promise<AppPresence>;
    onOpenAgent: (callback: (agentId: string) => void) => number;
    offOpenAgent: (id: number) => void;
  };
  inbox: {
    list: () => Promise<InboxView>;
    read: (id: string) => Promise<InboxView>;
    snooze: (id: string) => Promise<InboxView>;
    onChanged: (callback: () => void) => number;
    offChanged: (id: number) => void;
  };
  settings: {
    get: (options?: { refreshAuth?: boolean }) => Promise<SettingsView>;
    usage: (options?: { force?: boolean }) => Promise<CopilotUsageResult>;
    signOut: () => Promise<SettingsView>;
    startCopilotLogin: () => Promise<{ ok: boolean; message: string }>;
    saveGithubPat: (token: string) => Promise<void>;
    clearGithubPat: () => Promise<void>;
    saveJiraSite: (url: string) => Promise<void>;
    saveJiraToken: (token: string) => Promise<void>;
    clearJiraToken: () => Promise<void>;
    saveConfluence: (input: ConfluenceSettingsInput) => Promise<void>;
    saveConfluenceToken: (token: string) => Promise<void>;
    clearConfluenceToken: () => Promise<void>;
    saveDatadog: (input: DatadogSettingsInput) => Promise<void>;
  };
  dialog: {
    pickFolder: () => Promise<string | null>;
    pickFiles: () => Promise<AttachmentPick>;
  };
  models: {
    list: () => Promise<CopilotModel[]>;
  };
  skills: {
    list: (workspaceDir?: string | null) => Promise<SkillCatalog>;
    read: (workspaceDir: string | null, id: string, source: SkillSource) => Promise<SkillContent | null>;
    install: () => Promise<SkillInstallResult>;
  };
}
