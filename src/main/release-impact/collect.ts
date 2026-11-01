import fs from "fs";
import path from "path";
import type { ImpactConfig, RepoRole } from "../../shared/release-impact/types";
import { matchGlob, type ChangeSignals, type PolicyChange, type ScoreChange } from "../../shared/release-impact/score";
import { isInsideWorkspace } from "../../tools/workspace";
import type { ReleaseManifest } from "./config";
import { gitOutput, resolveRef } from "./git";

const ALWAYS_IGNORE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/target/**",
  "**/build/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
];
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|jar|dll|exe|woff2?|ttf|mp[34]|bin)$/i;
const DETAIL_LIMIT = 40;
const TICKET = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const ENDPOINT = /["'`](\/(?:api|v\d+)\/[A-Za-z0-9_./{}:-]+)["'`]/g;
const SELECTOR = /data-testid\s*=\s*["']([^"']+)["']|getByTestId\(\s*["']([^"']+)["']/g;
const SYMBOL = /\b(?:class|function|interface|type|def)\s+([A-Za-z_][A-Za-z0-9_]{2,})/g;

export type ResolvedRepo = {
  id: string;
  absolute: string;
  relative: string;
  role: RepoRole;
  framework?: string;
  testGlobs?: string[];
  caseIdPattern?: string;
  prodSha: string | null;
  candidateSha: string | null;
  error: string | null;
};

export type CollectResult = {
  repos: ResolvedRepo[];
  changes: ScoreChange[];
  policyChanges: PolicyChange[];
  changedFileCount: number;
  commits: string[];
  commitTickets: string[];
  unknowns: string[];
  missingGit: boolean;
};

export async function collectRelease(
  workspaceDir: string,
  config: ImpactConfig,
  manifest: ReleaseManifest | null,
  prodOverride: string | null,
  candidateOverride: string | null,
): Promise<CollectResult> {
  const repos: ResolvedRepo[] = [];
  const unknowns: string[] = [];
  let missingGit = false;
  for (const repo of config.repos) {
    const absolute = path.resolve(workspaceDir, repo.path);
    const resolved: ResolvedRepo = {
      id: repo.id,
      absolute,
      relative: repo.path,
      role: repo.role,
      framework: repo.framework,
      testGlobs: repo.testGlobs,
      caseIdPattern: repo.caseIdPattern,
      prodSha: null,
      candidateSha: null,
      error: null,
    };
    if (!isInsideWorkspace(workspaceDir, absolute)) {
      resolved.error = `${repo.id} is outside the workspace`;
      repos.push(resolved);
      continue;
    }
    if (!fs.existsSync(absolute)) {
      resolved.error = `${repo.id} path was not found: ${repo.path}`;
      repos.push(resolved);
      continue;
    }
    if (!realInside(workspaceDir, absolute)) {
      resolved.error = `${repo.id} resolves outside the workspace`;
      repos.push(resolved);
      continue;
    }
    const prodRef = manifest ? manifest.prod[repo.id] : prodOverride || repo.prod || "";
    const candidateRef = manifest ? manifest.candidate[repo.id] : candidateOverride || repo.candidate || "";
    if (!prodRef || !candidateRef) {
      resolved.error = `${repo.id} has no prod and candidate ref. Add them to the repo or the release manifest.`;
      repos.push(resolved);
      continue;
    }
    const prod = await resolveRef(absolute, prodRef);
    const candidate = await resolveRef(absolute, candidateRef);
    if (prod.missing || candidate.missing) missingGit = true;
    if (prod.error || candidate.error || !prod.sha || !candidate.sha) {
      resolved.error = prod.error ?? candidate.error ?? `${repo.id} refs did not resolve`;
    } else {
      resolved.prodSha = prod.sha;
      resolved.candidateSha = candidate.sha;
    }
    repos.push(resolved);
  }

  const changes: ScoreChange[] = [];
  const policyChanges: PolicyChange[] = [];
  const commits: string[] = [];
  const commitTickets: string[] = [];
  const ignore = [...ALWAYS_IGNORE, ...(config.ignore ?? [])];
  for (const repo of repos) {
    if (repo.error || !repo.prodSha || !repo.candidateSha) {
      if (repo.error) unknowns.push(repo.error);
      continue;
    }
    if (repo.prodSha === repo.candidateSha) continue;
    const names = await gitOutput(repo.absolute, [
      "diff",
      "--name-status",
      "--find-renames",
      `${repo.prodSha}...${repo.candidateSha}`,
    ]);
    if (!names.ok) {
      repo.error = `${repo.id} diff failed: ${names.error || "git diff failed"}`;
      unknowns.push(repo.error);
      continue;
    }
    const log = await gitOutput(repo.absolute, [
      "log",
      "--oneline",
      "--no-merges",
      "-n",
      "40",
      `${repo.prodSha}..${repo.candidateSha}`,
    ]);
    if (log.ok) {
      for (const line of log.text.split("\n").map((item) => item.trim()).filter(Boolean)) {
        commits.push(`${repo.id} ${line}`);
        for (const ticket of line.match(TICKET) ?? []) commitTickets.push(ticket);
      }
    }
    const parsed = parseNameStatus(names.text);
    if (names.text.includes("…truncated")) unknowns.push(`${repo.id} file list was truncated.`);
    for (const item of parsed) {
      const idPath = `${repo.id}/${item.path}`;
      const workspacePath = repo.relative === "." ? item.path : `${repo.relative}/${item.path}`;
      policyChanges.push({ idPath, workspacePath });
      if (ignored(idPath, workspacePath, ignore) || BINARY.test(item.path)) continue;
      changes.push({
        idPath,
        workspacePath,
        role: repo.role,
        status: item.status,
        line: 0,
        signals: emptySignals(),
      });
    }
  }

  const detailed = changes.slice(0, DETAIL_LIMIT);
  if (changes.length > DETAIL_LIMIT) {
    unknowns.push(`Signal extraction covered the first ${DETAIL_LIMIT} of ${changes.length} analyzed changed files.`);
  }
  for (const change of detailed) {
    const repo = repos.find((item) => change.idPath.startsWith(`${item.id}/`));
    if (!repo?.prodSha || !repo.candidateSha) continue;
    const relative = change.idPath.slice(repo.id.length + 1);
    const diff = await gitOutput(repo.absolute, [
      "diff",
      "-U0",
      `${repo.prodSha}...${repo.candidateSha}`,
      "--",
      relative,
    ]);
    if (!diff.ok) continue;
    const extracted = signalsFromDiff(diff.text);
    change.signals = extracted.signals;
    change.line = extracted.line;
    for (const ticket of extracted.signals.tickets) commitTickets.push(ticket);
    if (diff.text.includes("…truncated")) unknowns.push(`Diff truncated for ${change.workspacePath}.`);
  }

  return {
    repos,
    changes,
    policyChanges,
    changedFileCount: policyChanges.length,
    commits,
    commitTickets: [...new Set(commitTickets)],
    unknowns,
    missingGit,
  };
}

function parseNameStatus(text: string): { status: string; path: string }[] {
  const files: { status: string; path: string }[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t").map(unquote);
    const status = parts[0]?.slice(0, 1) ?? "M";
    const file = parts.length >= 3 ? parts[2] : parts[1];
    if (!file) continue;
    files.push({ status, path: file.replace(/\\/g, "/") });
  }
  return files;
}

function signalsFromDiff(diff: string): { signals: ChangeSignals; line: number } {
  const signals = emptySignals();
  let line = 0;
  let current = 0;
  for (const raw of diff.split("\n")) {
    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
    if (hunk) {
      current = Number(hunk[2]);
      if (!line) line = current;
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ")) continue;
    const added = raw.startsWith("+");
    const removed = raw.startsWith("-");
    if (!added && !removed) continue;
    const body = raw.slice(1);
    if (added && !line) line = current;
    collectSignals(body, signals, added, removed);
    if (added) current += 1;
  }
  return { signals, line };
}

export function collectSignals(body: string, signals: ChangeSignals, added: boolean, removed: boolean): void {
  for (const match of body.matchAll(ENDPOINT)) signals.endpoints.push(match[1]);
  for (const match of body.matchAll(SYMBOL)) signals.symbols.push(match[1]);
  for (const ticket of body.match(TICKET) ?? []) signals.tickets.push(ticket);
  for (const match of body.matchAll(SELECTOR)) {
    const selector = match[1] || match[2];
    if (!selector) continue;
    signals.selectors.push(selector);
    if (removed) signals.removedSelectors.push(selector);
    if (added) signals.addedSelectors.push(selector);
  }
}

export function emptySignals(): ChangeSignals {
  return { endpoints: [], selectors: [], symbols: [], tickets: [], removedSelectors: [], addedSelectors: [] };
}

function ignored(idPath: string, workspacePath: string, globs: string[]): boolean {
  return globs.some((glob) => matchGlob(glob, idPath) || matchGlob(glob, workspacePath));
}

function realInside(workspaceDir: string, target: string): boolean {
  try {
    return isInsideWorkspace(fs.realpathSync(workspaceDir), fs.realpathSync(target));
  } catch {
    return false;
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}
