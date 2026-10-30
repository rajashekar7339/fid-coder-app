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

export type ChatEvent =
  | { agentId: string; type: "user"; text: string }
  | { agentId: string; type: "text"; text: string }
  | { agentId: string; type: "tool-start"; toolName: string; text?: string }
  | { agentId: string; type: "tool-end"; toolName: string; ok: boolean; text?: string }
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
