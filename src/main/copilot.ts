import { createHash } from "crypto";
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { AUTO_MODEL_ID, catalogModels, type CatalogModel, type CatalogPrice } from "../shared/model";
import type { CopilotModel, SettingsView } from "../shared/types";
import type { AppTool, ToolContext } from "../tools/types";
import { clearSecret, getSecret, hasSecret, secretKeys } from "./secrets";
import { userDataDir } from "./paths";

type SdkEvent = { type?: string; data?: Record<string, unknown> };

type SessionLike = {
  sessionId?: string;
  rpc?: {
    model?: {
      list?: (params?: { skipCache?: boolean }) => Promise<{
        list?: CatalogModel[];
        modelPriceCategories?: CatalogPrice[];
      }>;
      switchTo?: (params: { modelId: string }) => Promise<unknown>;
    };
  };
  on(handler: (event: SdkEvent) => void): (() => void) | { unsubscribe?: () => void };
  sendAndWait(input: { prompt: string }, timeoutMs?: number): Promise<unknown>;
  abort?(): Promise<void> | void;
  disconnect?(): Promise<void> | void;
};

type AuthStatus = {
  isAuthenticated: boolean;
  authType?: string;
  host?: string;
  login?: string;
  statusMessage?: string;
};

type ClientLike = {
  start(): Promise<void>;
  stop?(): Promise<unknown>;
  createSession(config: Record<string, unknown>): Promise<SessionLike>;
  deleteSession?(sessionId: string): Promise<void>;
  listModels?(): Promise<CatalogModel[]>;
  getAuthStatus?(): Promise<AuthStatus>;
};

type SdkModule = {
  CopilotClient: new (options?: Record<string, unknown>) => ClientLike;
  RuntimeConnection?: {
    forStdio: (opts?: { path?: string }) => unknown;
  };
  approveAll?: (request: unknown) => unknown;
};

export type LiveSession = {
  session: SessionLike;
  unsubscribe(): void;
};

let client: ClientLike | null = null;
let clientKey = "";
let clientStarting: { key: string; promise: Promise<ClientLike> } | null = null;
let modelsInFlight: Promise<CopilotModel[]> | null = null;
let approveAll: ((request: unknown) => unknown) | null = null;
let exeCache: { path: string | null; at: number } | null = null;
let versionCache: { exe: string; version: string | null } | null = null;

export async function ensureClient(token: string | null): Promise<ClientLike> {
  const exe = resolveCopilotExe();
  const tokenKey = token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : "cli";
  const key = `${tokenKey}|${exe ?? "bundled"}`;
  if (client && clientKey === key) return client;
  if (clientStarting?.key === key) return clientStarting.promise;

  const pending = (async () => {
    await stopClient();
    const sdk = (await import("@github/copilot-sdk")) as unknown as SdkModule;
    approveAll = typeof sdk.approveAll === "function" ? sdk.approveAll : null;
    const options: Record<string, unknown> = {
      logLevel: "error",
      workingDirectory: userDataDir(),
    };
    if (token) options.gitHubToken = token;
    if (exe && sdk.RuntimeConnection) {
      options.connection = sdk.RuntimeConnection.forStdio({ path: exe });
    }
    const next = new sdk.CopilotClient(options);
    await next.start();
    client = next;
    clientKey = key;
    return next;
  })();

  clientStarting = { key, promise: pending };
  try {
    return await pending;
  } finally {
    if (clientStarting?.promise === pending) clientStarting = null;
  }
}

export async function stopClient(): Promise<void> {
  const current = client;
  client = null;
  clientKey = "";
  if (current?.stop) await current.stop().catch(() => undefined);
}

type AccountApi = {
  getAllUsers?: () => Promise<unknown>;
  logout?: (params: { selectionId?: string }) => Promise<unknown>;
};

export async function signOutCopilot(): Promise<void> {
  let token: string | null = null;
  try {
    token = hasSecret(secretKeys.copilot) ? getSecret(secretKeys.copilot) : null;
  } catch {
    token = null;
  }
  try {
    const current = await ensureClient(token);
    await logoutActiveAccount(current);
  } finally {
    clearSecret(secretKeys.copilot);
    await stopClient();
  }
  const status = await getCopilotStatus();
  if (status.signedIn) {
    throw new Error(`${status.authStatus}. Copilot is still signed in on this computer.`);
  }
}

async function logoutActiveAccount(current: ClientLike): Promise<void> {
  const account = (current as unknown as { rpc?: { account?: AccountApi } }).rpc?.account;
  if (!account?.logout) {
    throw new Error("This Copilot CLI cannot sign out from the app.");
  }
  const auth = await current.getAuthStatus?.();
  const login = auth?.login ?? null;
  let users: unknown[] = [];
  try {
    const listed = await account.getAllUsers?.();
    if (Array.isArray(listed)) users = listed;
  } catch {
    users = [];
  }
  const match = users.find((item) => loginOf(item) === login) ?? users[0];
  const selectionId = selectionIdOf(match);
  if (!selectionId) {
    throw new Error("No signed-in Copilot account was found to sign out.");
  }
  try {
    await account.logout({ selectionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Copilot sign out failed";
    if (/ghp_|github_pat_|gho_|ghu_|eyJ/.test(message)) {
      throw new Error("Copilot sign out failed.");
    }
    throw error instanceof Error ? error : new Error(message);
  }
}

function loginOf(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const login = (item as { authInfo?: { login?: unknown } }).authInfo?.login;
  return typeof login === "string" ? login : null;
}

function selectionIdOf(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  const selectionId = (item as { selectionId?: unknown }).selectionId;
  return typeof selectionId === "string" && selectionId.length > 0 ? selectionId : null;
}

export function listCopilotModels(): Promise<CopilotModel[]> {
  if (modelsInFlight) return modelsInFlight;
  const pending = loadCopilotModels().finally(() => {
    if (modelsInFlight === pending) modelsInFlight = null;
  });
  modelsInFlight = pending;
  return pending;
}

async function loadCopilotModels(): Promise<CopilotModel[]> {
  const token = hasSecret(secretKeys.copilot) ? getSecret(secretKeys.copilot) : null;
  const copilot = await ensureClient(token);
  const clientModels = copilot.listModels ? await copilot.listModels().catch(() => []) : [];
  const sessionCatalog = await readSessionCatalog(copilot);
  return catalogModels({
    clientModels: Array.isArray(clientModels) ? clientModels : [],
    sessionModels: sessionCatalog.sessionModels,
    priceCategories: sessionCatalog.priceCategories,
  });
}

async function readSessionCatalog(copilot: ClientLike): Promise<{ sessionModels: CatalogModel[]; priceCategories: CatalogPrice[] }> {
  let session: SessionLike | null = null;
  try {
    session = await copilot.createSession({
      model: AUTO_MODEL_ID,
      clientName: "fid-coder",
      streaming: true,
      availableTools: [],
      infiniteSessions: { enabled: false },
      onPermissionRequest: () => ({ kind: "reject", feedback: "Only Fid Coder tools are allowed" }),
    });
    const listed = await session.rpc?.model?.list?.({ skipCache: true });
    return {
      sessionModels: Array.isArray(listed?.list) ? listed.list : [],
      priceCategories: Array.isArray(listed?.modelPriceCategories) ? listed.modelPriceCategories : [],
    };
  } catch {
    return { sessionModels: [], priceCategories: [] };
  } finally {
    const sessionId = session?.sessionId;
    await Promise.resolve(session?.disconnect?.()).catch(() => undefined);
    if (sessionId) await copilot.deleteSession?.(sessionId).catch(() => undefined);
  }
}

export async function openSession(input: {
  model: string;
  systemMessage: string;
  tools: AppTool[];
  getContext: () => ToolContext;
  onToolStart: (name: string, preview: string) => void;
  onToolEnd: (name: string, ok: boolean, text: string) => void;
}): Promise<LiveSession> {
  const token = hasSecret(secretKeys.copilot) ? (await import("./secrets")).getSecret(secretKeys.copilot) : null;
  const copilot = await ensureClient(token);
  const allowed = new Set(input.tools.map((tool) => tool.name));
  const session = await copilot.createSession({
    streaming: true,
    model: input.model,
    clientName: "fid-coder",
    systemMessage: { mode: "replace", content: input.systemMessage },
    availableTools: [...allowed],
    tools: input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      skipPermission: true,
      defer: "never",
      handler: async (args: unknown) => {
        const preview = previewArgs(args);
        input.onToolStart(tool.name, preview);
        try {
          const result = await tool.handler(args, input.getContext());
          input.onToolEnd(tool.name, true, result);
          return result;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          input.onToolEnd(tool.name, false, message);
          return JSON.stringify({ ok: false, error: message });
        }
      },
    })),
    onPermissionRequest: (request: unknown) => decidePermission(request, allowed),
  });
  if (input.model !== AUTO_MODEL_ID) {
    try {
      await session.rpc?.model?.switchTo?.({ modelId: input.model });
    } catch (error) {
      await Promise.resolve(session.disconnect?.()).catch(() => undefined);
      throw new Error(modelSwitchError(error, input.model));
    }
  }
  return {
    session,
    unsubscribe() {
      /* Event subscription is attached by the caller. */
    },
  };
}

function modelSwitchError(error: unknown, model: string): string {
  const fallback = `Copilot could not use ${model}. Choose Auto or another model.`;
  const message = error instanceof Error ? error.message : fallback;
  if (!message.trim() || /ghp_|github_pat_|gho_|ghu_|eyJ/.test(message)) return fallback;
  return message;
}

function decidePermission(request: unknown, allowed: Set<string>): unknown {
  const name = toolNameOf(request);
  if (name && allowed.has(name)) {
    return approveAll ? approveAll(request) : { kind: "approved" };
  }
  return { kind: "reject", feedback: "Only Fid Coder tools are allowed" };
}

function toolNameOf(request: unknown): string {
  if (!request || typeof request !== "object") return "";
  const record = request as Record<string, unknown>;
  if (typeof record.toolName === "string") return record.toolName;
  if (typeof record.name === "string") return record.name;
  const tool = record.tool;
  if (tool && typeof tool === "object" && typeof (tool as { name?: string }).name === "string") {
    return (tool as { name: string }).name;
  }
  return "";
}

function previewArgs(args: unknown): string {
  try {
    return JSON.stringify(args).slice(0, 180);
  } catch {
    return "";
  }
}

export function readAssistantText(response: unknown, fallback: string): string {
  if (typeof response === "string" && response.trim()) return response;
  if (response && typeof response === "object") {
    const record = response as { data?: { content?: string }; content?: string };
    if (typeof record.data?.content === "string" && record.data.content.trim()) return record.data.content;
    if (typeof record.content === "string" && record.content.trim()) return record.content;
  }
  return fallback;
}

export function detach(subscription: (() => void) | { unsubscribe?: () => void }): void {
  if (typeof subscription === "function") subscription();
  else subscription.unsubscribe?.();
}

export async function getCopilotStatus(): Promise<SettingsView> {
  const exe = resolveCopilotExe();
  const version = exe ? readVersion(exe) : null;
  const stored = hasSecret(secretKeys.copilot);
  let token: string | null = null;
  try {
    token = stored ? getSecret(secretKeys.copilot) : null;
  } catch {
    token = null;
  }

  let auth: AuthStatus | null = null;
  if (exe || token) {
    try {
      const current = await ensureClient(token);
      auth = (await current.getAuthStatus?.()) ?? null;
    } catch {
      auth = null;
    }
  }

  const signedIn = auth?.isAuthenticated === true;
  const loginName = signedIn ? (auth?.login ?? null) : null;
  let authStatus = "Not signed in";
  if (signedIn) {
    const who = loginName ? ` as ${loginName}` : "";
    authStatus = token ? `Signed in${who} with a saved token` : `Signed in${who}`;
  } else if (!exe) {
    authStatus = "Copilot CLI was not found. Install GitHub Copilot CLI, then try again.";
  } else if (auth?.statusMessage?.trim()) {
    authStatus = auth.statusMessage.trim();
  }

  return {
    cliFound: Boolean(exe),
    cliVersion: version,
    authStatus,
    signedIn,
    loginName,
    hasStoredToken: stored,
    hasGithubPat: hasSecret(secretKeys.githubPat),
    hasJiraToken: hasSecret(secretKeys.jira),
    jiraSiteUrl: "",
  };
}

export async function startCopilotLogin(): Promise<{ ok: boolean; message: string }> {
  const exe = resolveCopilotExe();
  if (!exe) {
    return { ok: false, message: "Copilot CLI was not found on PATH. Install GitHub Copilot CLI, then try again." };
  }
  await stopClient();
  if (process.env.FID_CODER_FAKE_LOGIN === "1") {
    return { ok: true, message: "Copilot login started. Finish the sign-in in the browser. This app checks until you are signed in." };
  }
  const child = spawn(exe, ["login"], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  return { ok: true, message: "Copilot login started. Finish the sign-in in the browser. This app checks until you are signed in." };
}

function resolveCopilotExe(): string | null {
  const now = Date.now();
  if (exeCache && (exeCache.path || now - exeCache.at < 30_000)) return exeCache.path;
  const found = findCopilotExe();
  exeCache = { path: found, at: now };
  if (!found) versionCache = null;
  return found;
}

function findCopilotExe(): string | null {
  const result = spawnSync("where.exe", ["copilot"], { encoding: "utf8", windowsHide: true, timeout: 4000 });
  if (result.status === 0) {
    const exe = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.toLowerCase().endsWith(".exe"));
    if (exe && fs.existsSync(exe)) return exe;
  }
  const root = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
  if (!fs.existsSync(root)) return null;
  for (const entry of fs.readdirSync(root)) {
    if (!entry.toLowerCase().startsWith("github.copilot")) continue;
    const candidate = path.join(root, entry, "copilot.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readVersion(exe: string): string | null {
  if (versionCache?.exe === exe) return versionCache.version;
  const result = spawnSync(exe, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 8000 });
  const line = `${result.stdout || ""}\n${result.stderr || ""}`
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  const version = line || null;
  versionCache = { exe, version };
  return version;
}
