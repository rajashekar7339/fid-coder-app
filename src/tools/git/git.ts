import { asRecord, optionalBoolean, optionalNumber, optionalString } from "../args";
import { isMissingExecutable, runArgv } from "../process";
import type { AppTool, ToolContext } from "../types";
import { relativeInside, resolveInside, workspaceRoot } from "../workspace";

const GIT_TIMEOUT_MS = 20_000;
const DIFF_CAP = 16_000;
const PR_DIFF_CAP = 48_000;
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$/;

export const gitTools: AppTool[] = [
  {
    name: "git_status",
    description: "Show the branch and a short git status for this workspace. Use this instead of shell_run for git status.",
    parameters: { type: "object", properties: {} },
    handler: async (_args, ctx) => git(ctx, ["status", "--short", "--branch"]),
  },
  {
    name: "git_diff",
    description:
      "Show the diff against HEAD. Returns a stat summary unless full is true. path limits the diff to one file or folder inside the workspace. Use this instead of shell_run.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional path relative to the workspace" },
        full: { type: "boolean", description: "Return the full diff. Default false returns a stat." },
      },
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const requested = optionalString(record, "path");
      const relative = requested ? relativeInside(workspaceRoot(ctx.workspaceDir), resolveInside(ctx.workspaceDir, requested)) : "";
      const argsList = ["diff", "HEAD"];
      if (!optionalBoolean(record, "full")) argsList.push("--stat");
      if (relative) argsList.push("--", relative);
      const text = await git(ctx, argsList);
      if (text === "(no output)") return "No changes.";
      return text.length > DIFF_CAP ? `${text.slice(0, DIFF_CAP)}\n…truncated` : text;
    },
  },
  {
    name: "git_log",
    description: "Show recent commits, one per line. limit defaults to 10 and cannot be more than 30. Use this instead of shell_run.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "How many commits. Default 10, maximum 30." },
      },
    },
    handler: async (args, ctx) => {
      const limit = Math.max(1, Math.min(30, Math.floor(optionalNumber(asRecord(args), "limit", 10))));
      return git(ctx, ["log", "-n", String(limit), "--oneline"]);
    },
  },
  {
    name: "gh_pr_view",
    description:
      "Read one pull request as a short summary. number is optional; omit it to use the pull request for HEAD. Uses gh when it is on PATH, otherwise the GitHub API for this workspace's origin.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "string", description: "Pull request number. Omit for the pull request associated with HEAD." },
      },
    },
    handler: async (args, ctx) => {
      const number = pullNumber(optionalString(asRecord(args), "number"));
      const argsList = ["pr", "view"];
      if (number) argsList.push(number);
      argsList.push("--json", "number,title,url,state,author,baseRefName,headRefName,body");
      return formatPullRequest(await ghOrApi(ctx, argsList, () => fetchPullJson(ctx, number)));
    },
  },
  {
    name: "gh_pr_diff",
    description:
      "Read the diff of a pull request. number is optional. Uses gh when it is on PATH, otherwise the GitHub API for this workspace's origin. Output is clipped.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "string", description: "Pull request number. Omit for the pull request associated with HEAD." },
      },
    },
    handler: async (args, ctx) => {
      const number = pullNumber(optionalString(asRecord(args), "number"));
      const argsList = ["pr", "diff"];
      if (number) argsList.push(number);
      const text = await ghOrApi(ctx, argsList, () => fetchPullDiff(ctx, number));
      return clipDiff(text, PR_DIFF_CAP);
    },
  },
];

async function git(ctx: ToolContext, args: string[]): Promise<string> {
  return runTool("git", args, ctx);
}

async function ghOrApi(ctx: ToolContext, args: string[], api: () => Promise<string>): Promise<string> {
  try {
    return await runTool("gh", args, ctx);
  } catch {
    // Fall back when gh is missing or not signed in; the GitHub API path can
    // still work with the saved token, or anonymously for a public repo.
    return api();
  }
}

type GitHubRemote = { api: string; owner: string; repo: string };

export function parseGitHubRemote(raw: string): GitHubRemote | null {
  const cleaned = raw.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  const patterns = [
    /^https?:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/([^/]+)$/i,
    /^ssh:\/\/(?:[^@/]+@)?([^/]+)\/([^/]+)\/([^/]+)$/i,
    /^git@([^:]+):([^/]+)\/([^/]+)$/i,
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    const host = match[1].toLowerCase();
    const owner = match[2];
    const repo = match[3];
    if (!owner || !repo || owner.includes("..") || repo.includes("..")) return null;
    const api = host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
    return { api, owner, repo };
  }
  return null;
}

async function githubRemote(ctx: ToolContext): Promise<GitHubRemote> {
  let url = "";
  try {
    url = await git(ctx, ["remote", "get-url", "origin"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/no such remote|not a git repository/i.test(message)) {
      throw new Error("This workspace has no origin remote, so the pull request cannot be loaded.");
    }
    throw error;
  }
  const parsed = parseGitHubRemote(url);
  if (!parsed) throw new Error("origin is not a GitHub repository URL, so the pull request cannot be loaded.");
  return parsed;
}

function repoUrl(remote: GitHubRemote, suffix: string): string {
  return `${remote.api}/repos/${encodeURIComponent(remote.owner)}/${encodeURIComponent(remote.repo)}${suffix}`;
}

async function resolvePullNumber(ctx: ToolContext, remote: GitHubRemote, number: string | null): Promise<string> {
  if (number) return number;
  const sha = await git(ctx, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("Could not read HEAD. Pass a pull request number.");
  const list = await githubJson(
    ctx,
    repoUrl(remote, `/commits/${sha}/pulls`),
    "No pull request is associated with HEAD. Pass a pull request number.",
  );
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("No pull request is associated with HEAD. Pass a pull request number.");
  }
  const open = list.find((item) => item && typeof item === "object" && (item as { state?: unknown }).state === "open");
  const chosen = open && typeof open === "object" ? open : list[0];
  const found = chosen && typeof chosen === "object" ? (chosen as { number?: unknown }).number : null;
  if (typeof found !== "number") throw new Error("No pull request is associated with HEAD. Pass a pull request number.");
  return String(found);
}

async function fetchPullJson(ctx: ToolContext, number: string | null): Promise<string> {
  const remote = await githubRemote(ctx);
  const pull = await resolvePullNumber(ctx, remote, number);
  const body = await githubJson(ctx, repoUrl(remote, `/pulls/${pull}`));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("GitHub returned an unexpected pull request.");
  const record = body as Record<string, unknown>;
  const user = record.user && typeof record.user === "object" ? (record.user as { login?: unknown }).login : "";
  const base = record.base && typeof record.base === "object" ? (record.base as { ref?: unknown }).ref : "";
  const head = record.head && typeof record.head === "object" ? (record.head as { ref?: unknown }).ref : "";
  return JSON.stringify({
    number: record.number,
    title: record.title,
    url: record.html_url,
    state: record.state,
    author: { login: user },
    baseRefName: base,
    headRefName: head,
    body: record.body,
  });
}

type PullFile = { filename: string; status: string; additions: number; deletions: number; patch: string };

async function fetchPullDiff(ctx: ToolContext, number: string | null): Promise<string> {
  const remote = await githubRemote(ctx);
  const pull = await resolvePullNumber(ctx, remote, number);
  try {
    const files = await listPullFiles(ctx, remote, pull);
    if (files.length > 0) return renderPullFiles(files);
  } catch {
    /* The raw diff still answers the review when the file list fails. */
  }
  return githubText(ctx, repoUrl(remote, `/pulls/${pull}`), "application/vnd.github.diff");
}

async function listPullFiles(ctx: ToolContext, remote: GitHubRemote, number: string): Promise<PullFile[]> {
  const files: PullFile[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const data = await githubJson(ctx, repoUrl(remote, `/pulls/${number}/files?per_page=100&page=${page}`));
    if (!Array.isArray(data) || data.length === 0) break;
    for (const file of data) {
      if (!file || typeof file !== "object") continue;
      const record = file as {
        filename?: unknown;
        status?: unknown;
        additions?: unknown;
        deletions?: unknown;
        patch?: unknown;
      };
      const filename = typeof record.filename === "string" ? record.filename : "";
      if (!filename) continue;
      files.push({
        filename,
        status: typeof record.status === "string" ? record.status : "changed",
        additions: typeof record.additions === "number" ? record.additions : 0,
        deletions: typeof record.deletions === "number" ? record.deletions : 0,
        patch: typeof record.patch === "string" ? record.patch : "",
      });
    }
    if (data.length < 100) break;
  }
  return files;
}

function renderPullFiles(files: PullFile[]): string {
  const header = files.map((file) => `${file.status} ${file.filename} +${file.additions} -${file.deletions}`).join("\n");
  let body = `Pull request files:\n${header}\n`;
  const omitted: string[] = [];
  for (const file of files) {
    if (LOCKFILE.test(file.filename)) {
      omitted.push(`${file.filename} (lockfile omitted)`);
      continue;
    }
    const patch = file.patch || "(no patch; GitHub omitted it)";
    const section = `\n## ${file.filename}\n${patch}\n`;
    if (body.length + section.length > PR_DIFF_CAP) {
      omitted.push(`${file.filename} (past the diff cap)`);
      continue;
    }
    body += section;
  }
  if (omitted.length > 0) body += `\nNot shown:\n${omitted.join("\n")}\n`;
  return body;
}

function githubHeaders(ctx: ToolContext, accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": "fid-coder",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (ctx.githubPat) headers.Authorization = `Bearer ${ctx.githubPat}`;
  return headers;
}

async function githubText(ctx: ToolContext, url: string, accept: string, notFound?: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { headers: githubHeaders(ctx, accept), signal: AbortSignal.timeout(GIT_TIMEOUT_MS) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub request failed: ${message}`);
  }
  const text = await response.text();
  if (!response.ok) throw githubStatusError(response.status, text, notFound);
  return text;
}

async function githubJson(ctx: ToolContext, url: string, notFound?: string): Promise<unknown> {
  const text = await githubText(ctx, url, "application/vnd.github+json", notFound);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("GitHub returned a response that was not JSON.");
  }
}

function githubStatusError(status: number, body: string, notFound?: string): Error {
  if (status === 404) {
    return new Error(notFound || "Pull request was not found. Check the number and that origin points at the repository.");
  }
  const detail = publicDetail(body);
  if (status === 401 || status === 403) {
    if (/rate limit/i.test(detail)) {
      return new Error("GitHub rate limit was reached. Save a GitHub token in Settings and try again.");
    }
    return new Error("GitHub refused the request. Save a GitHub token in Settings if this repository is private.");
  }
  return new Error(detail ? `GitHub API ${status}: ${detail}` : `GitHub API ${status}`);
}

function publicDetail(body: string): string {
  return body
    .replace(/\s+/g, " ")
    .replace(/gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/g, "[token]")
    .trim()
    .slice(0, 180);
}

function clipDiff(text: string, cap = DIFF_CAP): string {
  if (!text.trim()) return "(no output)";
  return text.length > cap ? `${text.slice(0, cap)}\n…truncated` : text;
}

async function runTool(executable: string, args: string[], ctx: ToolContext): Promise<string> {
  const root = workspaceRoot(ctx.workspaceDir);
  let result: { code: number | null; stdout: string; stderr: string };
  try {
    result = await runArgv(executable, args, root, GIT_TIMEOUT_MS, toolEnv(ctx));
  } catch (error) {
    if (isMissingExecutable(error)) throw new Error(`${executable} was not found on PATH`);
    throw error;
  }
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 500);
    throw new Error(detail || `${executable} failed`);
  }
  return result.stdout.trim() || "(no output)";
}

function toolEnv(ctx: ToolContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.COPILOT_GITHUB_TOKEN;
  if (ctx.githubPat) {
    env.GH_TOKEN = ctx.githubPat;
    env.GITHUB_TOKEN = ctx.githubPat;
  }
  return env;
}

function pullNumber(value: string | null): string | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) throw new Error("number must be a pull request number");
  return value;
}

function formatPullRequest(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw.slice(0, 4_000);
  }
  if (!parsed || typeof parsed !== "object") return raw.slice(0, 4_000);
  const record = parsed as Record<string, unknown>;
  const author = record.author && typeof record.author === "object" ? (record.author as { login?: unknown }).login : "";
  const body = typeof record.body === "string" ? record.body.slice(0, 2_000) : "";
  return [
    `#${String(record.number ?? "")} ${String(record.title ?? "")}`.trim(),
    [record.state, record.url].filter((item) => typeof item === "string" && item).join(" "),
    `${String(record.headRefName ?? "")} -> ${String(record.baseRefName ?? "")}${author ? ` by ${String(author)}` : ""}`.trim(),
    body,
  ]
    .filter(Boolean)
    .join("\n");
}
