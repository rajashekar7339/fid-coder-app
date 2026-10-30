import { BrowserWindow, dialog, ipcMain } from "electron";
import { channels } from "../shared/channels";
import { normalizeModelId } from "../shared/model";
import { normalizeToolProfile } from "../shared/tool-profile";
import type { AgentInput, RoutineInput, RoutinePatch } from "../shared/types";
import type { BrowserManager } from "./browser-manager";
import { assertCron, nextRunIso } from "./cron";
import {
  getCopilotStatus,
  getCopilotUsage,
  listCopilotModels,
  signOutCopilot,
  startCopilotLogin,
  stopClient,
  watchCopilotUsage,
} from "./copilot";
import type { AppDatabase } from "./db";
import type { Runner } from "./runner";
import type { Scheduler } from "./scheduler";
import { clearSecret, secretKeys, setSecret } from "./secrets";

type AppServices = {
  db: AppDatabase;
  runner: Runner;
  scheduler: Scheduler;
  browser: BrowserManager;
  getWindow: () => BrowserWindow | null;
};

export function registerIpc(services: AppServices): void {
  const { db, runner, scheduler, browser } = services;

  ipcMain.handle(channels.agentsList, () => db.listAgents());
  ipcMain.handle(channels.agentsCreate, (_event, input: AgentInput) => db.createAgent(cleanAgent(input)));
  ipcMain.handle(channels.agentsUpdate, async (_event, id: string, input: AgentInput) => {
    const agent = db.updateAgent(id, cleanAgent(input));
    await runner.dropSession(id);
    return agent;
  });
  ipcMain.handle(channels.agentsDelete, async (_event, id: string) => {
    await runner.dropSession(id);
    try {
      await browser.deleteProfile(id);
    } catch (error) {
      console.error("Failed to remove browser profile", error);
    }
    db.deleteAgent(id);
    scheduler.reload();
  });

  ipcMain.handle(channels.messagesList, (_event, agentId: string) => db.listMessages(agentId));
  ipcMain.handle(channels.chatSend, async (_event, agentId: string, text: string) => {
    await runner.runTurn({ agentId, text: String(text ?? ""), source: "chat" });
  });
  ipcMain.handle(channels.chatRunning, (_event, agentId: string) => runner.isRunning(String(agentId ?? "")));
  ipcMain.handle(channels.chatAbort, async (_event, agentId: string) => {
    await runner.abort(agentId);
  });

  ipcMain.handle(channels.browserPreview, (_event, agentId: string) => browser.preview(String(agentId ?? "")));
  ipcMain.handle(channels.browserFocus, (_event, agentId: string) => browser.focus(String(agentId ?? "")));

  ipcMain.handle(channels.routinesList, (_event, agentId: string) => db.listRoutines(agentId));
  ipcMain.handle(channels.routinesCreate, (_event, input: RoutineInput) => {
    const cleaned = cleanRoutine(input);
    if (!db.getAgent(cleaned.agentId)) throw new Error("Agent not found");
    const routine = db.createRoutine(cleaned, cleaned.enabled ? nextRunIso(cleaned.cron) : null);
    scheduler.reload();
    return routine;
  });
  ipcMain.handle(channels.routinesUpdate, (_event, id: string, patch: RoutinePatch) => {
    const current = db.getRoutine(id);
    if (!current) throw new Error("Routine not found");
    const cronExpr = patch.cron == null ? current.cron : assertCron(patch.cron);
    const enabled = patch.enabled ?? current.enabled;
    const routine = db.updateRoutine(id, { ...patch, cron: cronExpr }, enabled ? nextRunIso(cronExpr) : null);
    scheduler.reload();
    return routine;
  });
  ipcMain.handle(channels.routinesDelete, (_event, id: string) => {
    db.deleteRoutine(id);
    scheduler.reload();
  });
  ipcMain.handle(channels.routinesRun, async (_event, id: string) => {
    await scheduler.runNow(id);
    const routine = db.getRoutine(id);
    if (!routine) throw new Error("Routine not found");
    return routine;
  });

  ipcMain.handle(channels.settingsGet, async (_event, options?: { refreshAuth?: boolean }) => {
    if (options?.refreshAuth) await stopClient();
    const status = {
      ...(await getCopilotStatus()),
      jiraSiteUrl: db.getSetting("jira_site_url") ?? "",
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
    db.setSetting("jira_site_url", cleanUrl(url));
    await runner.dropAllSessions();
  });
  ipcMain.handle(channels.settingsSaveJiraToken, async (_event, token: string) => {
    setSecret(secretKeys.jira, token);
    await runner.dropAllSessions();
  });
  ipcMain.handle(channels.settingsClearJiraToken, async () => {
    clearSecret(secretKeys.jira);
    await runner.dropAllSessions();
  });

  ipcMain.handle(channels.modelsList, () => listCopilotModels());

  ipcMain.handle(channels.dialogPickFolder, async () => {
    const parent = services.getWindow();
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ["openDirectory"] })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled) return null;
    return result.filePaths[0] ?? null;
  });
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
  };
}

function cleanRoutine(input: RoutineInput): RoutineInput {
  const name = input?.name?.trim();
  const prompt = input?.prompt?.trim();
  if (!input?.agentId) throw new Error("Agent is required");
  if (!name) throw new Error("Routine name is required");
  if (!prompt) throw new Error("Routine prompt is required");
  return {
    agentId: input.agentId,
    name,
    prompt,
    cron: assertCron(input.cron ?? ""),
    enabled: input.enabled !== false,
    notify: input.notify !== false,
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
