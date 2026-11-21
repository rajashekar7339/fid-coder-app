import fs from "fs";
import path from "path";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { channels } from "../../shared/channels";
import { isApprovalAction } from "../../shared/approval";
import { parseAgentPlacement } from "../../shared/agent-list";
import { parseQuestionReply } from "../../shared/question";
import { parseSkillDraft } from "../../shared/skill-draft";
import { normalizeModelId } from "../../shared/model";
import { isConfluenceMode, normalizeConfluenceSite } from "../../shared/confluence";
import { skillVersionLabel } from "../../shared/skills";
import { normalizeToolProfile } from "../../shared/tool-profile";
import type {
  AgentInput,
  ApprovalAction,
  AttachmentPick,
  ConfluenceSettingsInput,
  MessageAttachment,
  FactInput,
  FactPatch,
  RoutineInput,
  RoutinePatch,
  SkillInstallResult,
  SkillSource,
} from "../../shared/types";
import type { BrowserManager } from "../browser/browser-manager";
import type { CheckpointStore } from "../workspace/checkpoints";
import {
  getCopilotStatus,
  getCopilotUsage,
  listCopilotModels,
  signOutCopilot,
  startCopilotLogin,
  stopClient,
  watchCopilotUsage,
} from "../copilot";
import type { AppDatabase } from "../db";
import type { Runner } from "../chat/runner";
import type { Scheduler } from "../routines/scheduler";
import type { RoutineService } from "../routines/service";
import { clearSecret, getSecret, hasSecret, secretKeys, setSecret } from "../secrets";
import { currentInbox } from "../routines/inbox";
import { createFact, removeFact, updateFact } from "../facts";
import { appPresence, saveAppPresence } from "../routines/presence";
import { assertInboxAction } from "../../shared/inbox";
import { snoozeUntilIso } from "../../shared/routine-runs";
import { logJiraSettingsChange, logWarn } from "../log";
import { listSkillInfo, readSkill, skillRoots } from "../skills";
import { installSkill, planSkillImport } from "../skills/install";
import { userSkillsDir } from "../paths";
import { createAgentsFile, ruleFilePath, workspaceRules } from "../workspace/workspace-rules";
import { listWorkspaceDirectory } from "../workspace/file-tree";
import { readWorkspaceFile } from "../workspace/file-peek";
import { readWorkspaceImage } from "../workspace/image-peek";
import { describeAttachmentFiles } from "../workspace/attachments";

type AppServices = {
  db: AppDatabase;
  runner: Runner;
  scheduler: Scheduler;
  routines: RoutineService;
  browser: BrowserManager;
  checkpoints: CheckpointStore;
  getWindow: () => BrowserWindow | null;
  noteInbox?: () => void;
};

export function registerIpc(services: AppServices): void {
  const { db, runner, scheduler, routines, browser, checkpoints } = services;
  const noteInbox = () => services.noteInbox?.();

  ipcMain.handle(channels.agentsList, () => db.listAgents());
  ipcMain.handle(channels.agentsCreate, (_event, input: AgentInput) => db.createAgent(cleanAgent(input)));
  ipcMain.handle(channels.agentsUpdate, async (_event, id: string, input: AgentInput) => {
    const before = db.getAgent(id);
    const agent = db.updateAgent(id, cleanAgent(input));
    if (before?.workspaceDir !== agent.workspaceDir) checkpoints.clearAgent(id);
    await runner.dropSession(id);
    return agent;
  });
  ipcMain.handle(channels.agentsClearMemory, async (_event, id: string) => {
    const agent = db.clearMemorySummary(String(id ?? ""));
    await runner.dropSession(agent.id);
    return agent;
  });
  ipcMain.handle(channels.agentsPlace, (_event, id: string, placement: unknown) =>
    db.placeAgent(String(id ?? ""), parseAgentPlacement(placement)),
  );
  ipcMain.handle(channels.agentsDelete, async (_event, id: string) => {
    runner.clearQueue(id);
    await runner.dropSession(id);
    try {
      await browser.deleteProfile(id);
    } catch (error) {
      console.error("Failed to remove browser profile", error);
    }
    checkpoints.clearAgent(id);
    db.deleteAgent(id);
    scheduler.reload();
  });

  ipcMain.handle(channels.factsList, (_event, agentId: string) => db.listFacts(String(agentId ?? "")));
  ipcMain.handle(channels.factsCreate, (_event, input: FactInput) => createFact(db, runner, input));
  ipcMain.handle(channels.factsUpdate, (_event, id: string, patch: FactPatch) =>
    updateFact(db, runner, String(id ?? ""), patch ?? {}),
  );
  ipcMain.handle(channels.factsDelete, (_event, id: string) => removeFact(db, runner, String(id ?? "")));

  ipcMain.handle(channels.messagesList, (_event, agentId: string) => db.listMessages(agentId));
  ipcMain.handle(
    channels.chatSend,
    async (_event, agentId: string, text: string, attachments?: MessageAttachment[]) => {
      await runner.runTurn({
        agentId,
        text: String(text ?? ""),
        source: "chat",
        attachments: Array.isArray(attachments) ? attachments : [],
      });
    },
  );
  ipcMain.handle(
    channels.chatEnqueue,
    (_event, agentId: string, text: string, attachments?: MessageAttachment[]) =>
      runner.enqueue({
        agentId: String(agentId ?? ""),
        text: String(text ?? ""),
        attachments: Array.isArray(attachments) ? attachments : [],
      }),
  );
  ipcMain.handle(channels.chatQueue, (_event, agentId: string) =>
    runner.listQueue(String(agentId ?? "")),
  );
  ipcMain.handle(
    channels.chatUpdateQueued,
    (_event, agentId: string, id: string, text: string) =>
      runner.updateQueued(String(agentId ?? ""), String(id ?? ""), String(text ?? "")),
  );
  ipcMain.handle(channels.chatRemoveQueued, (_event, agentId: string, id: string) =>
    runner.removeQueued(String(agentId ?? ""), String(id ?? "")),
  );
  ipcMain.handle(channels.chatClearQueue, (_event, agentId: string) =>
    runner.clearQueue(String(agentId ?? "")),
  );
  ipcMain.handle(
    channels.chatForceSend,
    async (_event, agentId: string, text: string, attachments?: MessageAttachment[]) => {
      await runner.forceSend({
        agentId: String(agentId ?? ""),
        text: String(text ?? ""),
        attachments: Array.isArray(attachments) ? attachments : [],
      });
    },
  );
  ipcMain.handle(channels.chatForceQueued, async (_event, agentId: string, id: string) => {
    await runner.forceQueued(String(agentId ?? ""), String(id ?? ""));
  });
  ipcMain.handle(
    channels.chatEditMessage,
    (_event, agentId: string, messageId: string, text: string) =>
      runner.editMessage({
        agentId: String(agentId ?? ""),
        messageId: String(messageId ?? ""),
        text: String(text ?? ""),
      }),
  );
  ipcMain.handle(channels.chatDeleteMessage, (_event, agentId: string, messageId: string) =>
    runner.deleteMessage({
      agentId: String(agentId ?? ""),
      messageId: String(messageId ?? ""),
    }),
  );
  ipcMain.handle(channels.chatRunning, (_event, agentId: string) => runner.isRunning(String(agentId ?? "")));
  ipcMain.handle(channels.chatRunningAll, () => runner.runningAgentIds());
  ipcMain.handle(channels.chatAbort, async (_event, agentId: string) => {
    await runner.abort(agentId);
  });
  ipcMain.handle(channels.chatEnhance, (_event, agentId: string, text: string) =>
    runner.enhanceDraft(String(agentId ?? ""), String(text ?? "")),
  );
  ipcMain.handle(channels.chatApproval, (_event, approvalId: string, action: ApprovalAction) => {
    if (!isApprovalAction(action)) throw new Error("Unknown approval action");
    return runner.resolveApproval(String(approvalId ?? ""), action);
  });
  ipcMain.handle(channels.chatQuestion, (_event, questionId: string, reply: unknown) =>
    runner.resolveQuestion(String(questionId ?? ""), parseQuestionReply(reply)),
  );
  ipcMain.handle(channels.questionsPending, (_event, agentId?: string) =>
    runner.listPendingQuestions(agentId ? String(agentId) : undefined),
  );
  ipcMain.handle(channels.browserHandoffDone, (_event, handoffId: string) =>
    runner.completeHandoff(String(handoffId ?? "")),
  );
  ipcMain.handle(channels.browserHandoffTakeover, (_event, handoffId: string) =>
    runner.takeoverHandoff(String(handoffId ?? "")),
  );
  ipcMain.handle(channels.browserHandoffsPending, (_event, agentId?: string) =>
    runner.listPendingHandoffs(agentId ? String(agentId) : undefined),
  );
  ipcMain.handle(channels.skillsSaveDecide, (_event, requestId: string, allow: unknown, draft: unknown) => {
    if (typeof allow !== "boolean") throw new Error("Missing decision");
    const parsed = allow && draft !== undefined ? parseSkillDraft(draft) : undefined;
    return runner.decideSkillSave(String(requestId ?? ""), allow, parsed);
  });
  ipcMain.handle(channels.skillsSavePending, (_event, agentId?: string) =>
    runner.listPendingSkillSaves(agentId ? String(agentId) : undefined),
  );
  ipcMain.handle(channels.approvalsPending, (_event, agentId?: string) =>
    runner.listPendingApprovals(agentId ? String(agentId) : undefined),
  );
  ipcMain.handle(channels.approvalsHistory, (_event, agentId: string, limit?: number) =>
    db.listApprovals(String(agentId ?? ""), limit ?? 50),
  );
  ipcMain.handle(channels.approvalsRules, (_event, agentId?: string) =>
    db.listApprovalRules(agentId ? String(agentId) : undefined),
  );
  ipcMain.handle(channels.approvalsDeleteRule, (_event, id: string) => db.deleteApprovalRule(String(id ?? "")));

  ipcMain.handle(channels.browserPreview, (_event, agentId: string) => browser.preview(String(agentId ?? "")));
  ipcMain.handle(channels.browserFocus, (_event, agentId: string) => browser.focus(String(agentId ?? "")));

  ipcMain.handle(channels.changesLatest, (_event, agentId: string) => checkpoints.latest(String(agentId ?? "")));
  ipcMain.handle(channels.changesList, (_event, agentId: string, limit?: number) =>
    checkpoints.list(String(agentId ?? ""), typeof limit === "number" ? limit : 30),
  );
  ipcMain.handle(channels.changesDiff, (_event, changeId: string) => checkpoints.diff(String(changeId ?? "")));
  ipcMain.handle(channels.changesRevert, (_event, changeId: string) => checkpoints.revert(String(changeId ?? "")));
  ipcMain.handle(channels.changesRevertTurn, (_event, turnId: string) => checkpoints.revertTurn(String(turnId ?? "")));

  ipcMain.handle(channels.contextPreview, (_event, agentId: string) =>
    runner.previewContext(String(agentId ?? "")),
  );

  ipcMain.handle(channels.workspaceRules, (_event, agentId: string) => {
    const agent = db.getAgent(String(agentId ?? ""));
    if (!agent?.workspaceDir) return [];
    return workspaceRules(agent.workspaceDir).files;
  });
  ipcMain.handle(channels.workspaceCreateRules, (_event, agentId: string) => {
    const agent = db.getAgent(String(agentId ?? ""));
    if (!agent?.workspaceDir) throw new Error("Pick a workspace folder for this agent first");
    return createAgentsFile(agent.workspaceDir).files;
  });
  ipcMain.handle(channels.workspaceOpenRule, async (_event, agentId: string, relative: string) => {
    const agent = db.getAgent(String(agentId ?? ""));
    if (!agent?.workspaceDir) throw new Error("Pick a workspace folder for this agent first");
    const file = ruleFilePath(agent.workspaceDir, String(relative ?? ""));
    if (!file) throw new Error("That file is not a project rules file");
    const error = await shell.openPath(file);
    if (error) throw new Error(error);
  });
  ipcMain.handle(channels.workspaceMapGet, (_event, agentId: string) =>
    runner.getWorkspaceMap(String(agentId ?? "")),
  );
  ipcMain.handle(channels.workspaceMapBuild, (_event, agentId: string) =>
    runner.buildWorkspaceMap(String(agentId ?? "")),
  );
  ipcMain.handle(channels.workspaceList, async (_event, agentId: string, relative?: string) => {
    const agent = db.getAgent(String(agentId ?? ""));
    if (!agent?.workspaceDir) throw new Error("Pick a workspace folder for this agent first");
    return listWorkspaceDirectory(agent.workspaceDir, String(relative ?? ""));
  });
  ipcMain.handle(
    channels.workspaceFileRead,
    (
      _event,
      agentId: string,
      relative: string,
      line?: number | null,
      endLine?: number | null,
      startLine?: number | null,
      limit?: number | null,
    ) => {
      const agent = db.getAgent(String(agentId ?? ""));
      if (!agent?.workspaceDir) throw new Error("Pick a workspace folder for this agent first");
      return readWorkspaceFile(
        agent.workspaceDir,
        String(relative ?? ""),
        typeof line === "number" ? line : null,
        typeof endLine === "number" ? endLine : null,
        typeof startLine === "number" ? startLine : null,
        typeof limit === "number" ? limit : null,
      );
    },
  );
  ipcMain.handle(channels.workspaceImageRead, (_event, agentId: string, relative: string) => {
    const agent = db.getAgent(String(agentId ?? ""));
    if (!agent?.workspaceDir) throw new Error("Pick a workspace folder for this agent first");
    return readWorkspaceImage(agent.workspaceDir, String(relative ?? ""));
  });

  ipcMain.handle(channels.routinesList, (_event, agentId: string) => routines.list(agentId));
  ipcMain.handle(channels.routinesCreate, (_event, input: RoutineInput) => {
    const { agentId, ...draft } = input;
    return routines.create(agentId, draft);
  });
  ipcMain.handle(channels.routinesUpdate, (_event, id: string, patch: RoutinePatch) =>
    routines.update(id, patch),
  );
  ipcMain.handle(channels.routinesDelete, (_event, id: string) => {
    routines.remove(id);
  });
  ipcMain.handle(channels.routinesRun, async (_event, id: string) => {
    await scheduler.runNow(id);
    const routine = db.getRoutine(id);
    if (!routine) throw new Error("Routine not found");
    return routine;
  });
  ipcMain.handle(channels.routinesHistory, (_event, agentId: string) => db.listRoutineRuns(String(agentId ?? "")));
  ipcMain.handle(channels.routinesStop, async (_event, runId: string) => {
    await scheduler.stopRun(String(runId ?? ""));
    noteInbox();
  });
  ipcMain.handle(channels.appPresence, () => appPresence(db));
  ipcMain.handle(channels.appPresenceSet, (_event, patch: unknown) =>
    saveAppPresence(db, patch, (paused) => scheduler.setPaused(paused)),
  );
  ipcMain.handle(channels.inboxList, () => currentInbox(db, runner.listPendingApprovals()));
  ipcMain.handle(channels.inboxRead, (_event, id: string) => {
    const itemId = String(id ?? "");
    assertInboxAction(itemId);
    db.readInbox(itemId);
    noteInbox();
    return currentInbox(db, runner.listPendingApprovals());
  });
  ipcMain.handle(channels.inboxSnooze, (_event, id: string) => {
    const itemId = String(id ?? "");
    assertInboxAction(itemId);
    db.snoozeInbox(itemId, snoozeUntilIso(Date.now()));
    noteInbox();
    return currentInbox(db, runner.listPendingApprovals());
  });

  ipcMain.handle(channels.settingsGet, async (_event, options?: { refreshAuth?: boolean }) => {
    if (options?.refreshAuth) await stopClient();
    const status = {
      ...(await getCopilotStatus()),
      jiraSiteUrl: db.getSetting("jira_site_url") ?? "",
      ...confluenceSettings(db),
      ...appPresence(db),
    };
    watchCopilotUsage(status.signedIn);
    return status;
  });
  ipcMain.handle(channels.settingsUsage, async (_event, options?: { force?: boolean }) => {
    const status = await getCopilotStatus();
    if (!status.signedIn) {
      watchCopilotUsage(false);
      return { usage: null, message: null };
    }
    watchCopilotUsage(true);
    return getCopilotUsage(options?.force === true);
  });
  ipcMain.handle(channels.settingsSignOut, async () => {
    await runner.dropAllSessions();
    await signOutCopilot();
    return {
      ...(await getCopilotStatus()),
      jiraSiteUrl: db.getSetting("jira_site_url") ?? "",
      ...confluenceSettings(db),
      ...appPresence(db),
    };
  });
  ipcMain.handle(channels.settingsLogin, async () => {
    await runner.dropAllSessions();
    return startCopilotLogin();
  });
  ipcMain.handle(channels.settingsSaveGithubPat, async (_event, token: string) => {
    setSecret(secretKeys.githubPat, token);
    await runner.dropAllSessions();
  });
  ipcMain.handle(channels.settingsClearGithubPat, async () => {
    clearSecret(secretKeys.githubPat);
    await runner.dropAllSessions();
  });
  ipcMain.handle(channels.settingsSaveJiraSite, async (_event, url: string) => {
    const site = cleanUrl(url);
    db.setSetting("jira_site_url", site);
    await runner.dropAllSessions();
    logJiraSettingsChange(site ? "site saved" : "site cleared", site, hasSecret(secretKeys.jira));
  });
  ipcMain.handle(channels.settingsSaveJiraToken, async (_event, token: string) => {
    setSecret(secretKeys.jira, token);
    try {
      getSecret(secretKeys.jira);
    } catch (error) {
      clearSecret(secretKeys.jira);
      logWarn(
        `Jira token save failed: Windows could not decrypt the saved token. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error("Windows could not decrypt the saved Jira token, so it was not kept. Save it again.");
    }
    await runner.dropAllSessions();
    logJiraSettingsChange("token saved", db.getSetting("jira_site_url"), true);
  });
  ipcMain.handle(channels.settingsClearJiraToken, async () => {
    clearSecret(secretKeys.jira);
    await runner.dropAllSessions();
    logJiraSettingsChange("token cleared", db.getSetting("jira_site_url"), false);
  });
  ipcMain.handle(channels.settingsSaveConfluence, async (_event, input: ConfluenceSettingsInput) => {
    if (!isConfluenceMode(input.mode)) throw new Error("Choose Cloud or Data Center for Confluence.");
    const site = normalizeConfluenceSite(String(input.siteUrl ?? ""), input.mode);
    db.setSetting("confluence_site_url", site);
    db.setSetting("confluence_email", String(input.email ?? "").trim());
    db.setSetting("confluence_mode", input.mode);
    await runner.dropAllSessions();
  });
  ipcMain.handle(channels.settingsSaveConfluenceToken, async (_event, token: string) => {
    setSecret(secretKeys.confluence, token);
    try {
      getSecret(secretKeys.confluence);
    } catch (error) {
      clearSecret(secretKeys.confluence);
      logWarn(
        `Confluence token save failed: Windows could not decrypt the saved token. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error("Windows could not decrypt the saved Confluence token, so it was not kept. Save it again.");
    }
    await runner.dropAllSessions();
  });
  ipcMain.handle(channels.settingsClearConfluenceToken, async () => {
    clearSecret(secretKeys.confluence);
    await runner.dropAllSessions();
  });

  ipcMain.handle(channels.modelsList, () => listCopilotModels());
  ipcMain.handle(channels.skillsList, (_event, workspaceDir?: string | null) =>
    listSkillInfo(skillRoots(cleanWorkspace(workspaceDir))),
  );
  ipcMain.handle(
    channels.skillsRead,
    (_event, workspaceDir: string | null, id: string, source?: SkillSource) =>
      readSkill(skillRoots(cleanWorkspace(workspaceDir)), String(id ?? ""), source),
  );
  ipcMain.handle(channels.skillsInstall, async (): Promise<SkillInstallResult> => {
    const source =
      process.env.FID_CODER_SKILL_IMPORT_DIR?.trim() || (await pickSkillSource(services.getWindow()));
    if (!source) return { status: "cancelled" };
    const plan = planSkillImport(source);
    if ("error" in plan) throw new Error(plan.error);
    const dest = userSkillsDir();
    const previous = readSkill([{ root: dest, source: "app" }], plan.id, "app");
    const exists = fs.existsSync(path.join(dest, plan.id));
    if (exists && !(await confirmSkillReplace(services.getWindow(), plan.id, previous))) {
      return { status: "cancelled" };
    }
    return { status: "installed", skill: installSkill(plan, dest, exists), previous };
  });

  ipcMain.handle(channels.dialogPickFolder, async () => {
    const parent = services.getWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle(channels.dialogPickFiles, async (): Promise<AttachmentPick> => {
    const override = process.env.FID_CODER_ATTACH_IMPORT_FILES?.trim();
    if (override) {
      const paths = override
        .split(path.delimiter)
        .map((item) => item.trim())
        .filter(Boolean);
      return describeAttachmentFiles(paths);
    }
    const parent = services.getWindow();
    const options = {
      title: "Attach files",
      properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return { attachments: [], errors: [] };
    return describeAttachmentFiles(result.filePaths);
  });
}

async function pickSkillSource(parent: BrowserWindow | null): Promise<string | null> {
  const result = parent
    ? await dialog.showOpenDialog(parent, { properties: ["openDirectory"] })
    : await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
}

async function confirmSkillReplace(
  parent: BrowserWindow | null,
  id: string,
  previous: { version: string | null } | null,
): Promise<boolean> {
  const options = {
    type: "warning" as const,
    buttons: ["Replace", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Replace skill",
    message: `A skill named ${id} is already installed${previous ? ` (${skillVersionLabel(previous.version)})` : ""}.`,
    detail: "Replace it with the selected skill?",
  };
  const result = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}

function confluenceSettings(db: AppDatabase) {
  const mode = db.getSetting("confluence_mode");
  return {
    hasConfluenceToken: hasSecret(secretKeys.confluence),
    confluenceSiteUrl: db.getSetting("confluence_site_url") ?? "",
    confluenceEmail: db.getSetting("confluence_email") ?? "",
    confluenceMode: isConfluenceMode(mode) ? mode : "data-center",
  };
}

function cleanWorkspace(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanAgent(input: AgentInput): AgentInput {
  const name = input?.name?.trim();
  const systemPrompt = input?.systemPrompt?.trim();
  if (!name) throw new Error("Name is required");
  if (!systemPrompt) throw new Error("System prompt is required");
  return {
    name,
    description: input.description?.trim().slice(0, 160) || "",
    systemPrompt,
    workspaceDir: input.workspaceDir?.trim() || null,
    model: normalizeModelId(input?.model),
    toolProfile: normalizeToolProfile(input?.toolProfile),
    readOnly: input.readOnly === true,
    memoryEnabled: input.memoryEnabled !== false,
  };
}

function cleanUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Jira site must be an http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Jira site must be an http or https URL");
  }
  return parsed.toString();
}
