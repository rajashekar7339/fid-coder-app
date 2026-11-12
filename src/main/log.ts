import fs from "fs";
import path from "path";
import { logPath, secretsPath } from "./paths";

const MAX_LOG_BYTES = 1_000_000;
const MAX_MESSAGE_CHARS = 2_000;

let lastJiraStatusKey: string | null = null;

type JiraStatus = {
  site: string | null;
  hasToken: boolean;
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
  const mode = status.askMode ? "ask" : "agent";
  const key = `${status.site ?? ""}|${status.hasToken}|${status.agentName ?? ""}|${mode}`;
  if (!options.force && key === lastJiraStatusKey) return;
  lastJiraStatusKey = key;

  const where = status.agentName ? ` for "${status.agentName}"` : "";
  const suffix = status.askMode ? " (Ask mode)" : "";
  if (status.site && status.hasToken) {
    logInfo(`Jira tools enabled${where}${suffix}: site=${status.site} token=present.`);
    return;
  }

  const missing =
    !status.site && !status.hasToken
      ? "the site URL and token are missing"
      : !status.site
        ? "the site URL is missing"
        : "the token is missing";
  logWarn(
    `Jira tools disabled${where}${suffix}: ${missing}. Browser agents will use the browser. ` +
      `Save both the site URL and the personal access token in Settings -> Jira. ` +
      `Token file: ${secretsPath()} (${status.hasToken ? "present" : "missing"}). ` +
      `Log: ${logPath()}.`,
  );
}

export function logJiraToolFailure(
  agentName: string,
  toolName: string,
  detail: string,
  status: { site: string | null; hasToken: boolean },
): void {
  logWarn(
    `Jira tool ${toolName} failed for "${agentName}": ${detail} ` +
      `site=${status.site ?? "missing"} token=${status.hasToken ? "present" : "missing"}. ` +
      `The agent may fall back to the browser. Log: ${logPath()}.`,
  );
}

export function logJiraSettingsChange(action: string, site: string | null, hasToken: boolean): void {
  const ready = Boolean(site) && hasToken;
  const message =
    `Jira settings ${action}: site=${site || "missing"} token=${hasToken ? "present" : "missing"}. ` +
    `${ready ? "Jira tools are enabled." : "Jira tools stay disabled until both are saved."} ` +
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
