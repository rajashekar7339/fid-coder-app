import fs from "fs";
import path from "path";
import { logPath, secretsPath } from "./paths";

const MAX_LOG_BYTES = 1_000_000;
const MAX_MESSAGE_CHARS = 2_000;

let lastJiraStatusKey: string | null = null;

type JiraStatus = {
  site: string | null;
  hasToken: boolean;
  hasCookie?: boolean;
  readable?: boolean;
  agentName?: string;
  askMode?: boolean;
};

export function logInfo(message: string): void {
  writeLine("INFO", message);
}

export function logWarn(message: string): void {
  writeLine("WARN", message);
}

export function logJiraStatus(status: JiraStatus, options: { force?: boolean } = {}): void {
  const hasCookie = status.hasCookie === true;
  const mode = status.askMode ? "ask" : "agent";
  const key = `${status.site ?? ""}|${status.hasToken}|${hasCookie}|${status.readable ?? "unknown"}|${status.agentName ?? ""}|${mode}`;
  if (!options.force && key === lastJiraStatusKey) return;
  lastJiraStatusKey = key;

  const where = status.agentName ? ` for "${status.agentName}"` : "";
  const suffix = status.askMode ? " (Ask mode)" : "";
  const authorized = status.hasToken || hasCookie;
  if (status.site && authorized && (hasCookie || status.readable !== false)) {
    logInfo(
      `Jira tools enabled${where}${suffix}: site=${status.site} ` +
        `token=${status.hasToken ? "present" : "missing"} cookie=${hasCookie ? "present" : "missing"}.`,
    );
    return;
  }

  const missing: string[] = [];
  if (!status.site) missing.push("the site URL is missing");
  if (!authorized) missing.push("no personal access token or browser session is saved");
  else if (!hasCookie && status.hasToken && status.readable === false) {
    missing.push("the saved token cannot be decrypted; save it again or sign in with the browser");
  }
  logWarn(
    `Jira tools disabled${where}${suffix}: ${missing.join(" and ")}. ` +
      `Save the site URL and either a personal access token or a browser sign-in in Settings -> Jira. ` +
      `Token file: ${secretsPath()} (${status.hasToken ? "present" : "missing"}). ` +
      `Log: ${logPath()}.`,
  );
}

export function logJiraToolFailure(
  agentName: string,
  toolName: string,
  detail: string,
  status: { site: string | null; hasToken: boolean; hasCookie?: boolean },
): void {
  logWarn(
    `Jira tool ${toolName} failed for "${agentName}": ${detail} ` +
      `site=${status.site ?? "missing"} token=${status.hasToken ? "present" : "missing"} ` +
      `cookie=${status.hasCookie ? "present" : "missing"}. ` +
      `The agent may fall back to the browser. Log: ${logPath()}.`,
  );
}

export function logJiraSettingsChange(
  action: string,
  site: string | null,
  hasToken: boolean,
  hasCookie = false,
): void {
  const ready = Boolean(site) && (hasToken || hasCookie);
  const message =
    `Jira settings ${action}: site=${site || "missing"} token=${hasToken ? "present" : "missing"} ` +
    `cookie=${hasCookie ? "present" : "missing"}. ` +
    `${ready ? "Jira tools are enabled." : "Jira tools stay disabled until the site and a token or browser sign-in are saved."} ` +
    `Log: ${logPath()}.`;
  if (ready) logInfo(message);
  else logWarn(message);
}

function writeLine(level: "INFO" | "WARN" | "ERROR", message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${cleanLogText(message)}\n`;
  try {
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotate(file);
    fs.appendFileSync(file, line, "utf8");
  } catch (error) {
    console.error("Failed to write diagnostics log", error);
  }
  if (level === "INFO") console.log(line.trim());
  else console.warn(line.trim());
}

function rotate(file: string): void {
  try {
    if (!fs.existsSync(file)) return;
    if (fs.statSync(file).size <= MAX_LOG_BYTES) return;
    const previous = `${file}.1`;
    if (fs.existsSync(previous)) fs.rmSync(previous, { force: true });
    fs.renameSync(file, previous);
  } catch {
    // If rotation fails, keep appending to the current file.
  }
}

export function cleanLogText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/authorization:\s*[^,\s]+/gi, "authorization: [redacted]")
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .slice(0, MAX_MESSAGE_CHARS)
    .trim();
}
