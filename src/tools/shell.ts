import { spawn } from "child_process";
import path from "path";
import { DELETE_CONFIRM_MARKER } from "../shared/types";
import { asRecord, optionalNumber, optionalString, requiredString } from "./args";
import { needsDeleteConfirmation } from "./shell-policy";
import type { AppTool } from "./types";

const MAX_OUTPUT = 20000;

export const shellTools: AppTool[] = [
  {
    name: "shell_run",
    description:
      "Run a command with cmd.exe inside this agent's workspace folder. Use it for git and gh. Deletes need the user's approval; without confirmed: true, a delete returns DELETE_CONFIRM_REQUIRED. Do not print tokens or environment variables.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", description: "Optional directory inside the workspace" },
        timeoutSeconds: { type: "number", description: "1 to 120, default 30" },
        confirmed: {
          type: "boolean",
          description: "Set true only after the user explicitly approves this exact delete in chat.",
        },
      },
      required: ["command"],
    },
    handler: async (args, ctx) => {
      if (!ctx.workspaceDir) {
        throw new Error("Pick a workspace folder for this agent before running commands");
      }
      const record = asRecord(args);
      const command = requiredString(record, "command");
      if (command.length > 4000) throw new Error("Command is too long");
      const cwd = resolveInside(ctx.workspaceDir, optionalString(record, "cwd"));
      const timeoutSeconds = Math.max(1, Math.min(120, Math.floor(optionalNumber(record, "timeoutSeconds", 30))));
      if (needsDeleteConfirmation(command) && record.confirmed !== true) {
        throw new Error(
          `${DELETE_CONFIRM_MARKER}${command}\nThis delete did not run. Ask the user to approve it in chat, then call shell_run again with confirmed: true.`,
        );
      }
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.COPILOT_GITHUB_TOKEN;
      if (ctx.githubPat) {
        env.GH_TOKEN = ctx.githubPat;
        env.GITHUB_TOKEN = ctx.githubPat;
      }
      if (ctx.jiraToken) env.JIRA_API_TOKEN = ctx.jiraToken;
      if (ctx.jiraSite) env.JIRA_SITE = ctx.jiraSite;

      const result = await runCmd(command, cwd, timeoutSeconds * 1000, env);
      return JSON.stringify({
        ok: result.code === 0,
        status: result.code,
        stdout: clip(result.stdout),
        stderr: clip(result.stderr),
      });
    },
  },
];

function resolveInside(root: string, child: string | null): string {
  const target = child ? path.resolve(root, child) : path.resolve(root);
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the workspace folder");
  }
  return target;
}

function clip(value: string): string {
  return value.length > MAX_OUTPUT ? `${value.slice(0, MAX_OUTPUT)}\n…truncated` : value;
}

function runCmd(
  command: string,
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("cmd.exe", ["/d", "/s", "/c", command], {
      cwd,
      env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
