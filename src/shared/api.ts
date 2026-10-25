import type {
  Agent,
  AgentInput,
  BrowserPreview,
  ChatEvent,
  CopilotModel,
  Message,
  Routine,
  RoutineInput,
  RoutinePatch,
  SettingsView,
} from "./types";

export interface FidApi {
  agents: {
    list: () => Promise<Agent[]>;
    create: (input: AgentInput) => Promise<Agent>;
    update: (id: string, input: AgentInput) => Promise<Agent>;
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
  routines: {
    list: (agentId: string) => Promise<Routine[]>;
    create: (input: RoutineInput) => Promise<Routine>;
    update: (id: string, patch: RoutinePatch) => Promise<Routine>;
    delete: (id: string) => Promise<void>;
    run: (id: string) => Promise<Routine>;
  };
  settings: {
    get: (options?: { refreshAuth?: boolean }) => Promise<SettingsView>;
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
