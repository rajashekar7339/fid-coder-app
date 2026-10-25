import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { FidApi } from "../shared/api";
import type { AgentInput, ChatEvent, RoutineInput, RoutinePatch, TaskInput } from "../shared/types";

// Sandboxed preloads cannot require sibling files, so these names are inlined.
// They match src/shared/channels.ts.
const channels = {
  agentsList: "agents:list",
  agentsCreate: "agents:create",
  agentsUpdate: "agents:update",
  agentsDelete: "agents:delete",
  messagesList: "messages:list",
  chatSend: "chat:send",
  chatAbort: "chat:abort",
  chatEvent: "chat:event",
  routinesList: "routines:list",
  routinesCreate: "routines:create",
  routinesUpdate: "routines:update",
  routinesDelete: "routines:delete",
  tasksList: "tasks:list",
  tasksAdd: "tasks:add",
  tasksSetDone: "tasks:set-done",
  tasksDelete: "tasks:delete",
  settingsGet: "settings:get",
  settingsSignOut: "settings:sign-out",
  settingsLogin: "settings:login",
  settingsSaveCopilotToken: "settings:save-copilot-token",
  settingsClearCopilotToken: "settings:clear-copilot-token",
  settingsSaveGithubPat: "settings:save-github-pat",
  settingsClearGithubPat: "settings:clear-github-pat",
  settingsSaveJiraSite: "settings:save-jira-site",
  settingsSaveJiraToken: "settings:save-jira-token",
  settingsClearJiraToken: "settings:clear-jira-token",
  dialogPickFolder: "dialog:pick-folder",
  browserClose: "browser:close",
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
  routines: {
    list: (agentId: string) => ipcRenderer.invoke(channels.routinesList, agentId),
    create: (input: RoutineInput) => ipcRenderer.invoke(channels.routinesCreate, input),
    update: (id: string, patch: RoutinePatch) => ipcRenderer.invoke(channels.routinesUpdate, id, patch),
    delete: (id: string) => ipcRenderer.invoke(channels.routinesDelete, id),
  },
  tasks: {
    list: (agentId: string) => ipcRenderer.invoke(channels.tasksList, agentId),
    add: (input: TaskInput) => ipcRenderer.invoke(channels.tasksAdd, input),
    setDone: (id: string, done: boolean) => ipcRenderer.invoke(channels.tasksSetDone, id, done),
    delete: (id: string) => ipcRenderer.invoke(channels.tasksDelete, id),
  },
  settings: {
    get: () => ipcRenderer.invoke(channels.settingsGet),
    signOut: () => ipcRenderer.invoke(channels.settingsSignOut),
    startCopilotLogin: () => ipcRenderer.invoke(channels.settingsLogin),
    saveCopilotToken: (token: string) => ipcRenderer.invoke(channels.settingsSaveCopilotToken, token),
    clearCopilotToken: () => ipcRenderer.invoke(channels.settingsClearCopilotToken),
    saveGithubPat: (token: string) => ipcRenderer.invoke(channels.settingsSaveGithubPat, token),
    clearGithubPat: () => ipcRenderer.invoke(channels.settingsClearGithubPat),
    saveJiraSite: (url: string) => ipcRenderer.invoke(channels.settingsSaveJiraSite, url),
    saveJiraToken: (token: string) => ipcRenderer.invoke(channels.settingsSaveJiraToken, token),
    clearJiraToken: () => ipcRenderer.invoke(channels.settingsClearJiraToken),
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke(channels.dialogPickFolder),
  },
  browser: {
    close: (agentId: string) => ipcRenderer.invoke(channels.browserClose, agentId),
  },
};

contextBridge.exposeInMainWorld("fid", api);
