import type {
  Agent,
  AgentInput,
  ChatEvent,
  Message,
  Routine,
  RoutineInput,
  RoutinePatch,
  SettingsView,
  Task,
  TaskInput,
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
    abort: (agentId: string) => Promise<void>;
    onEvent: (callback: (event: ChatEvent) => void) => number;
    offEvent: (id: number) => void;
  };
  routines: {
    list: (agentId: string) => Promise<Routine[]>;
    create: (input: RoutineInput) => Promise<Routine>;
    update: (id: string, patch: RoutinePatch) => Promise<Routine>;
    delete: (id: string) => Promise<void>;
  };
  tasks: {
    list: (agentId: string) => Promise<Task[]>;
    add: (input: TaskInput) => Promise<Task>;
    setDone: (id: string, done: boolean) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };
  settings: {
    get: () => Promise<SettingsView>;
    signOut: () => Promise<SettingsView>;
    startCopilotLogin: () => Promise<{ ok: boolean; message: string }>;
    saveCopilotToken: (token: string) => Promise<void>;
    clearCopilotToken: () => Promise<void>;
    saveGithubPat: (token: string) => Promise<void>;
    clearGithubPat: () => Promise<void>;
    saveJiraSite: (url: string) => Promise<void>;
    saveJiraToken: (token: string) => Promise<void>;
    clearJiraToken: () => Promise<void>;
  };
  dialog: {
    pickFolder: () => Promise<string | null>;
  };
  browser: {
    close: (agentId: string) => Promise<void>;
  };
}
