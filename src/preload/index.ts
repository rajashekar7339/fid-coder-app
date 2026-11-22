import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { FidApi } from "../shared/api";
import type { SkillDraftInput } from "../shared/skill-draft";
import type {
  AgentInput,
  AgentPlacement,
  ApprovalAction,
  ApprovalRecord,
  ApprovalRequest,
  ApprovalRule,
  ApprovalRuleInput,
  BrowserHandoffRequest,
  ConfluenceSettingsInput,
  DatadogSettingsInput,
  QuestionReply,
  QuestionRequest,
  SkillSaveRequest,
  ChatEvent,
  MessageAttachment,
  QueuedMessage,
  FactInput,
  FactPatch,
  RoutineInput,
  RoutinePatch,
} from "../shared/types";
import type { AppPresence } from "../shared/app-settings";

// Sandboxed preloads cannot require sibling files, so these names are inlined.
// They match src/shared/channels.ts.
const channels = {
  agentsList: "agents:list",
  agentsCreate: "agents:create",
  agentsUpdate: "agents:update",
  agentsClearMemory: "agents:clear-memory",
  agentsDelete: "agents:delete",
  factsList: "facts:list",
  factsCreate: "facts:create",
  factsUpdate: "facts:update",
  factsDelete: "facts:delete",
  agentsPlace: "agents:place",
  messagesList: "messages:list",
  chatSend: "chat:send",
  chatEnqueue: "chat:enqueue",
  chatQueue: "chat:queue",
  chatUpdateQueued: "chat:update-queued",
  chatRemoveQueued: "chat:remove-queued",
  chatClearQueue: "chat:clear-queue",
  chatForceSend: "chat:force-send",
  chatForceQueued: "chat:force-queued",
  chatEditMessage: "chat:edit-message",
  chatDeleteMessage: "chat:delete-message",
  chatRunning: "chat:running",
  chatRunningAll: "chat:running-all",
  chatAbort: "chat:abort",
  chatEnhance: "chat:enhance",
  chatEvent: "chat:event",
  chatApproval: "chat:approval",
  chatQuestion: "chat:question",
  questionsPending: "questions:pending",
  approvalsPending: "approvals:pending",
  approvalsHistory: "approvals:history",
  approvalsRules: "approvals:rules",
  approvalsCreateRule: "approvals:create-rule",
  approvalsUpdateRule: "approvals:update-rule",
  approvalsDeleteRule: "approvals:delete-rule",
  browserPreview: "browser:preview",
  browserFocus: "browser:focus",
  browserHandoffDone: "browser:handoff-done",
  browserHandoffTakeover: "browser:handoff-takeover",
  browserHandoffsPending: "browser:handoffs-pending",
  changesLatest: "changes:latest",
  changesList: "changes:list",
  changesDiff: "changes:diff",
  changesRevert: "changes:revert",
  changesRevertTurn: "changes:revert-turn",
  contextPreview: "context:preview",
  workspaceRules: "workspace:rules",
  workspaceCreateRules: "workspace:create-rules",
  workspaceOpenRule: "workspace:open-rule",
  workspaceMapGet: "workspace:map",
  workspaceMapBuild: "workspace:map-build",
  workspaceList: "workspace:list",
  workspaceFileRead: "workspace:file-read",
  workspaceImageRead: "workspace:image-read",
  routinesList: "routines:list",
  routinesListAll: "routines:list-all",
  routinesCreate: "routines:create",
  routinesUpdate: "routines:update",
  routinesDelete: "routines:delete",
  routinesRun: "routines:run",
  routinesHistory: "routines:history",
  routinesStop: "routines:stop",
  appPresence: "app:presence",
  appPresenceSet: "app:presence-set",
  appOpenAgent: "app:open-agent",
  inboxList: "inbox:list",
  inboxRead: "inbox:read",
  inboxSnooze: "inbox:snooze",
  inboxChanged: "inbox:changed",
  settingsGet: "settings:get",
  settingsUsage: "settings:usage",
  settingsSignOut: "settings:sign-out",
  settingsLogin: "settings:login",
  settingsSaveGithubPat: "settings:save-github-pat",
  settingsClearGithubPat: "settings:clear-github-pat",
  settingsSaveDeepseekKey: "settings:save-deepseek-key",
  settingsClearDeepseekKey: "settings:clear-deepseek-key",
  settingsTestDeepseek: "settings:test-deepseek",
  settingsSaveJiraSite: "settings:save-jira-site",
  settingsSaveJiraToken: "settings:save-jira-token",
  settingsClearJiraToken: "settings:clear-jira-token",
  settingsSaveConfluence: "settings:save-confluence",
  settingsSaveConfluenceToken: "settings:save-confluence-token",
  settingsClearConfluenceToken: "settings:clear-confluence-token",
  settingsSaveDatadog: "settings:save-datadog",
  dialogPickFolder: "dialog:pick-folder",
  dialogPickFiles: "dialog:pick-files",
  modelsList: "models:list",
  skillsList: "skills:list",
  skillsRead: "skills:read",
  skillsInstall: "skills:install",
  skillsSaveDecide: "skills:save-decide",
  skillsSavePending: "skills:save-pending",
} as const;

const listeners = new Map<number, (event: IpcRendererEvent, payload: ChatEvent) => void>();
const pushListeners = new Map<number, (event: IpcRendererEvent, ...args: unknown[]) => void>();
let nextListener = 1;

function listen(channel: string, callback: (...args: unknown[]) => void): number {
  const id = nextListener++;
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args);
  pushListeners.set(id, listener);
  ipcRenderer.on(channel, listener);
  return id;
}

function unlisten(channel: string, id: number): void {
  const listener = pushListeners.get(id);
  if (!listener) return;
  ipcRenderer.removeListener(channel, listener);
  pushListeners.delete(id);
}

const api: FidApi = {
  agents: {
    list: () => ipcRenderer.invoke(channels.agentsList),
    create: (input: AgentInput) => ipcRenderer.invoke(channels.agentsCreate, input),
    update: (id: string, input: AgentInput) => ipcRenderer.invoke(channels.agentsUpdate, id, input),
    clearMemory: (id: string) => ipcRenderer.invoke(channels.agentsClearMemory, id),
    delete: (id: string) => ipcRenderer.invoke(channels.agentsDelete, id),
    place: (id: string, placement: AgentPlacement) => ipcRenderer.invoke(channels.agentsPlace, id, placement),
  },
  facts: {
    list: (agentId: string) => ipcRenderer.invoke(channels.factsList, agentId),
    create: (input: FactInput) => ipcRenderer.invoke(channels.factsCreate, input),
    update: (id: string, patch: FactPatch) => ipcRenderer.invoke(channels.factsUpdate, id, patch),
    delete: (id: string) => ipcRenderer.invoke(channels.factsDelete, id),
  },
  messages: {
    list: (agentId: string) => ipcRenderer.invoke(channels.messagesList, agentId),
  },
  chat: {
    send: (agentId: string, text: string, attachments?: MessageAttachment[]) =>
      ipcRenderer.invoke(channels.chatSend, agentId, text, attachments ?? []),
    enqueue: (agentId: string, text: string, attachments?: MessageAttachment[]): Promise<QueuedMessage[]> =>
      ipcRenderer.invoke(channels.chatEnqueue, agentId, text, attachments ?? []),
    queue: (agentId: string): Promise<QueuedMessage[]> =>
      ipcRenderer.invoke(channels.chatQueue, agentId),
    updateQueued: (agentId: string, id: string, text: string): Promise<QueuedMessage[]> =>
      ipcRenderer.invoke(channels.chatUpdateQueued, agentId, id, text),
    removeQueued: (agentId: string, id: string): Promise<QueuedMessage[]> =>
      ipcRenderer.invoke(channels.chatRemoveQueued, agentId, id),
    clearQueue: (agentId: string): Promise<QueuedMessage[]> =>
      ipcRenderer.invoke(channels.chatClearQueue, agentId),
    forceSend: (agentId: string, text: string, attachments?: MessageAttachment[]) =>
      ipcRenderer.invoke(channels.chatForceSend, agentId, text, attachments ?? []),
    forceQueued: (agentId: string, id: string) =>
      ipcRenderer.invoke(channels.chatForceQueued, agentId, id),
    editMessage: (agentId: string, messageId: string, text: string) =>
      ipcRenderer.invoke(channels.chatEditMessage, agentId, messageId, text),
    deleteMessage: (agentId: string, messageId: string) =>
      ipcRenderer.invoke(channels.chatDeleteMessage, agentId, messageId),
    running: (agentId: string) => ipcRenderer.invoke(channels.chatRunning, agentId),
    runningAll: () => ipcRenderer.invoke(channels.chatRunningAll),
    abort: (agentId: string) => ipcRenderer.invoke(channels.chatAbort, agentId),
    enhance: (agentId: string, text: string) => ipcRenderer.invoke(channels.chatEnhance, agentId, text),
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
  questions: {
    answer: (questionId: string, reply: QuestionReply) =>
      ipcRenderer.invoke(channels.chatQuestion, questionId, reply),
    pending: (agentId?: string): Promise<QuestionRequest[]> =>
      ipcRenderer.invoke(channels.questionsPending, agentId),
  },
  handoffs: {
    done: (handoffId: string) => ipcRenderer.invoke(channels.browserHandoffDone, handoffId),
    takeover: (handoffId: string) => ipcRenderer.invoke(channels.browserHandoffTakeover, handoffId),
    pending: (agentId?: string): Promise<BrowserHandoffRequest[]> =>
      ipcRenderer.invoke(channels.browserHandoffsPending, agentId),
  },
  skillSaves: {
    decide: (requestId: string, allow: boolean, draft?: SkillDraftInput) =>
      ipcRenderer.invoke(channels.skillsSaveDecide, requestId, allow, draft),
    pending: (agentId?: string): Promise<SkillSaveRequest[]> =>
      ipcRenderer.invoke(channels.skillsSavePending, agentId),
  },
  approvals: {
    decide: (approvalId: string, action: ApprovalAction) =>
      ipcRenderer.invoke(channels.chatApproval, approvalId, action),
    pending: (agentId?: string): Promise<ApprovalRequest[]> =>
      ipcRenderer.invoke(channels.approvalsPending, agentId),
    history: (agentId: string, limit?: number): Promise<ApprovalRecord[]> =>
      ipcRenderer.invoke(channels.approvalsHistory, agentId, limit),
    rules: (agentId?: string): Promise<ApprovalRule[]> =>
      ipcRenderer.invoke(channels.approvalsRules, agentId),
    createRule: (input: ApprovalRuleInput): Promise<ApprovalRule> =>
      ipcRenderer.invoke(channels.approvalsCreateRule, input),
    updateRule: (id: string, input: ApprovalRuleInput): Promise<ApprovalRule> =>
      ipcRenderer.invoke(channels.approvalsUpdateRule, id, input),
    deleteRule: (id: string) => ipcRenderer.invoke(channels.approvalsDeleteRule, id),
  },
  browser: {
    preview: (agentId: string) => ipcRenderer.invoke(channels.browserPreview, agentId),
    focus: (agentId: string) => ipcRenderer.invoke(channels.browserFocus, agentId),
  },
  changes: {
    latest: (agentId: string) => ipcRenderer.invoke(channels.changesLatest, agentId),
    list: (agentId: string, limit?: number) =>
      ipcRenderer.invoke(channels.changesList, agentId, limit ?? 30),
    diff: (changeId: string) => ipcRenderer.invoke(channels.changesDiff, changeId),
    revert: (changeId: string) => ipcRenderer.invoke(channels.changesRevert, changeId),
    revertTurn: (turnId: string) => ipcRenderer.invoke(channels.changesRevertTurn, turnId),
  },
  context: {
    preview: (agentId: string) => ipcRenderer.invoke(channels.contextPreview, agentId),
  },
  workspace: {
    rules: (agentId: string) => ipcRenderer.invoke(channels.workspaceRules, agentId),
    createRules: (agentId: string) => ipcRenderer.invoke(channels.workspaceCreateRules, agentId),
    openRule: (agentId: string, path: string) => ipcRenderer.invoke(channels.workspaceOpenRule, agentId, path),
    map: (agentId: string) => ipcRenderer.invoke(channels.workspaceMapGet, agentId),
    buildMap: (agentId: string) => ipcRenderer.invoke(channels.workspaceMapBuild, agentId),
    list: (agentId: string, path?: string) =>
      ipcRenderer.invoke(channels.workspaceList, agentId, path ?? ""),
    file: (
      agentId: string,
      path: string,
      line?: number | null,
      endLine?: number | null,
      startLine?: number | null,
      limit?: number | null,
    ) =>
      ipcRenderer.invoke(
        channels.workspaceFileRead,
        agentId,
        path,
        line ?? null,
        endLine ?? null,
        startLine ?? null,
        limit ?? null,
      ),
    image: (agentId: string, path: string) =>
      ipcRenderer.invoke(channels.workspaceImageRead, agentId, path),
  },
  routines: {
    list: (agentId: string) => ipcRenderer.invoke(channels.routinesList, agentId),
    listAll: () => ipcRenderer.invoke(channels.routinesListAll),
    create: (input: RoutineInput) => ipcRenderer.invoke(channels.routinesCreate, input),
    update: (id: string, patch: RoutinePatch) => ipcRenderer.invoke(channels.routinesUpdate, id, patch),
    delete: (id: string) => ipcRenderer.invoke(channels.routinesDelete, id),
    run: (id: string) => ipcRenderer.invoke(channels.routinesRun, id),
    history: (agentId: string) => ipcRenderer.invoke(channels.routinesHistory, agentId),
    stop: (runId: string) => ipcRenderer.invoke(channels.routinesStop, runId),
  },
  app: {
    presence: () => ipcRenderer.invoke(channels.appPresence),
    setPresence: (patch: Partial<AppPresence>) => ipcRenderer.invoke(channels.appPresenceSet, patch),
    onOpenAgent: (callback: (agentId: string) => void) => listen(channels.appOpenAgent, (agentId) => callback(String(agentId ?? ""))),
    offOpenAgent: (id: number) => unlisten(channels.appOpenAgent, id),
  },
  inbox: {
    list: () => ipcRenderer.invoke(channels.inboxList),
    read: (id: string) => ipcRenderer.invoke(channels.inboxRead, id),
    snooze: (id: string) => ipcRenderer.invoke(channels.inboxSnooze, id),
    onChanged: (callback: () => void) => listen(channels.inboxChanged, () => callback()),
    offChanged: (id: number) => unlisten(channels.inboxChanged, id),
  },
  settings: {
    get: (options?: { refreshAuth?: boolean }) => ipcRenderer.invoke(channels.settingsGet, options),
    usage: (options?: { force?: boolean }) => ipcRenderer.invoke(channels.settingsUsage, options),
    signOut: () => ipcRenderer.invoke(channels.settingsSignOut),
    startCopilotLogin: () => ipcRenderer.invoke(channels.settingsLogin),
    saveGithubPat: (token: string) => ipcRenderer.invoke(channels.settingsSaveGithubPat, token),
    clearGithubPat: () => ipcRenderer.invoke(channels.settingsClearGithubPat),
    saveDeepseekKey: (token: string) => ipcRenderer.invoke(channels.settingsSaveDeepseekKey, token),
    clearDeepseekKey: () => ipcRenderer.invoke(channels.settingsClearDeepseekKey),
    testDeepseek: () => ipcRenderer.invoke(channels.settingsTestDeepseek),
    saveJiraSite: (url: string) => ipcRenderer.invoke(channels.settingsSaveJiraSite, url),
    saveJiraToken: (token: string) => ipcRenderer.invoke(channels.settingsSaveJiraToken, token),
    clearJiraToken: () => ipcRenderer.invoke(channels.settingsClearJiraToken),
    saveConfluence: (input: ConfluenceSettingsInput) =>
      ipcRenderer.invoke(channels.settingsSaveConfluence, input),
    saveConfluenceToken: (token: string) =>
      ipcRenderer.invoke(channels.settingsSaveConfluenceToken, token),
    clearConfluenceToken: () => ipcRenderer.invoke(channels.settingsClearConfluenceToken),
    saveDatadog: (input: DatadogSettingsInput) =>
      ipcRenderer.invoke(channels.settingsSaveDatadog, input),
  },
  dialog: {
    pickFolder: () => ipcRenderer.invoke(channels.dialogPickFolder),
    pickFiles: () => ipcRenderer.invoke(channels.dialogPickFiles),
  },
  models: {
    list: () => ipcRenderer.invoke(channels.modelsList),
  },
  skills: {
    list: (workspaceDir?: string | null) => ipcRenderer.invoke(channels.skillsList, workspaceDir ?? null),
    read: (workspaceDir: string | null, id: string, source) =>
      ipcRenderer.invoke(channels.skillsRead, workspaceDir, id, source),
    install: () => ipcRenderer.invoke(channels.skillsInstall),
  },
};

contextBridge.exposeInMainWorld("fid", api);
