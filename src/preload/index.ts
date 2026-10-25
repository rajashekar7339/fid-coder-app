import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { FidApi } from "../shared/api";
import type { AgentInput, ChatEvent, RoutineInput, RoutinePatch } from "../shared/types";

// Sandboxed preloads cannot require sibling files, so these names are inlined.
// They match src/shared/channels.ts.
const channels = {
  agentsList: "agents:list",
  agentsCreate: "agents:create",
  agentsUpdate: "agents:update",
  agentsDelete: "agents:delete",
  messagesList: "messages:list",
  chatSend: "chat:send",
  chatRunning: "chat:running",
  chatAbort: "chat:abort",
  chatEvent: "chat:event",
  browserPreview: "browser:preview",
  browserFocus: "browser:focus",
  routinesList: "routines:list",
  routinesCreate: "routines:create",
  routinesUpdate: "routines:update",
  routinesDelete: "routines:delete",
  routinesRun: "routines:run",
  settingsGet: "settings:get",
  settingsSignOut: "settings:sign-out",
  settingsLogin: "settings:login",
  settingsSaveGithubPat: "settings:save-github-pat",
  settingsClearGithubPat: "settings:clear-github-pat",
  settingsSaveJiraSite: "settings:save-jira-site",
  settingsSaveJiraToken: "settings:save-jira-token",
  settingsClearJiraToken: "settings:clear-jira-token",
  dialogPickFolder: "dialog:pick-folder",
  modelsList: "models:list",
} as const;

const listeners = new Map<number, (event: IpcRendererEvent, payload: ChatEvent) => void>();
let nextListener = 1;

const api: FidApi = {
  agents: {
    list: () => ipcRenderer.invoke(channels.agentsList),
    create: (input: AgentInput) => ipcRenderer.invoke(channels.agentsCreate, input),
    update: (id: string, input: AgentInput) => ipcRenderer.invoke(channels.agentsUpdate, id, input),
    delete: (id: string) => ipcRenderer.invoke(channels.agentsDelete, id),
  },
  messages: {
    list: (agentId: string) => ipcRenderer.invoke(channels.messagesList, agentId),
  },
  chat: {
    send: (agentId: string, text: string) => ipcRenderer.invoke(channels.chatSend, agentId, text),
    running: (agentId: string) => ipcRenderer.invoke(channels.chatRunning, agentId),
    abort: (agentId: string) => ipcRenderer.invoke(channels.chatAbort, agentId),
    onEvent: (callback) => {
      const id = nextListener++;
      const listener = (_event: IpcRendererEvent, payload: ChatEvent) => callback(payload);
      listeners.set(id, listener);
      ipcRenderer.on(channels.chatEvent, listener);
      return id;
    },
    offEvent: (id: number) => {
      const listener = listeners.get(id);
      if (!listener) return;
      ipcRenderer.removeListener(channels.chatEvent, listener);
      listeners.delete(id);
    },
  },
  browser: {
    preview: (agentId: string) => ipcRenderer.invoke(channels.browserPreview, agentId),
    focus: (agentId: string) => ipcRenderer.invoke(channels.browserFocus, agentId),
  },
  routines: {
    list: (agentId: string) => ipcRenderer.invoke(channels.routinesList, agentId),
    create: (input: RoutineInput) => ipcRenderer.invoke(channels.routinesCreate, input),
    update: (id: string, patch: RoutinePatch) => ipcRenderer.invoke(channels.routinesUpdate, id, patch),
    delete: (id: string) => ipcRenderer.invoke(channels.routinesDelete, id),
    run: (id: string) => ipcRenderer.invoke(channels.routinesRun, id),
  },
  settings: {
    get: (options?: { refreshAuth?: boolean }) => ipcRenderer.invoke(channels.settingsGet, options),
    signOut: () => ipcRenderer.invoke(channels.settingsSignOut),
    startCopilotLogin: () => ipcRenderer.invoke(channels.settingsLogin),
    saveGithubPat: (token: string) => ipcRenderer.invoke(channels.settingsSaveGithubPat, token),
    clearGithubPat: () => ipcRenderer.invoke(channels.settingsClearGithubPat),
    saveJiraSite: (url: string) => ipcRenderer.invoke(channels.settingsSaveJiraSite, url),
    saveJiraToken: (token: string) => ipcRenderer.invoke(channels.settingsSaveJiraToken, token),
    clearJiraToken: () => ipcRenderer.invoke(channels.settingsClearJiraToken),
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke(channels.dialogPickFolder),
  },
  models: {
    list: () => ipcRenderer.invoke(channels.modelsList),
  },
};

contextBridge.exposeInMainWorld("fid", api);
