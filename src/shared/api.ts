import type {
  Agent,
  AgentInput,
  BrowserPreview,
  ChangeSet,
  ChatEvent,
  ContextView,
  CopilotModel,
  FileDiff,
  Message,
  PlanView,
  Routine,
  RoutineInput,
  RoutinePatch,
  SettingsView,
  WorkspaceRuleFile,
} from "./types";
import type { CopilotUsageResult } from "./copilot-usage";

export interface FidApi {
  agents: {
    list: () => Promise<Agent[]>;
    create: (input: AgentInput) => Promise<Agent>;
    update: (id: string, input: AgentInput) => Promise<Agent>;
    clearMemory: (id: string) => Promise<Agent>;
    delete: (id: string) => Promise<void>;
  };
  messages: {
    list: (agentId: string) => Promise<Message[]>;
  };
  chat: {
    send: (agentId: string, text: string) => Promise<void>;
    running: (agentId: string) => Promise<boolean>;
    abort: (agentId: string) => Promise<void>;
    onEvent: (callback: (event: ChatEvent) => void) => number;
    offEvent: (id: number) => void;
  };
  browser: {
    preview: (agentId: string) => Promise<BrowserPreview | null>;
    focus: (agentId: string) => Promise<boolean>;
  };
  changes: {
    latest: (agentId: string) => Promise<ChangeSet | null>;
    diff: (changeId: string) => Promise<FileDiff>;
    revert: (changeId: string) => Promise<void>;
    revertTurn: (turnId: string) => Promise<void>;
  };
  plans: {
    get: (agentId: string) => Promise<PlanView | null>;
  };
  context: {
    preview: (agentId: string) => Promise<ContextView>;
  };
  workspace: {
    rules: (agentId: string) => Promise<WorkspaceRuleFile[]>;
    createRules: (agentId: string) => Promise<WorkspaceRuleFile[]>;
    openRule: (agentId: string, path: string) => Promise<void>;
  };
  routines: {
    list: (agentId: string) => Promise<Routine[]>;
    create: (input: RoutineInput) => Promise<Routine>;
    update: (id: string, patch: RoutinePatch) => Promise<Routine>;
    delete: (id: string) => Promise<void>;
    run: (id: string) => Promise<Routine>;
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
  };
  dialog: {
    pickFolder: () => Promise<string | null>;
  };
  models: {
    list: () => Promise<CopilotModel[]>;
  };
}
