import fs from "fs";
import path from "path";
import { IMPACT_OUTPUT_ROOT } from "../../shared/release-impact/paths";
import { renderReport, renderSelection } from "../../shared/release-impact/report";
import { DEFAULT_MAX_CHANGED_FILES, scoreRelease } from "../../shared/release-impact/score";
import type { ImpactConfig, ImpactSummary, SelectedTests } from "../../shared/release-impact/types";
import { isInsideWorkspace } from "../../tools/workspace";
import { DEFAULT_MAX_TEST_FILES, indexAutomation } from "./adapters";
import { collectRelease, DEFAULT_MAX_DETAIL_FILES, type ResolvedRepo } from "./collect";
import { loadImpactConfig, readManifest } from "./config";

const SUMMARY_MUST = 20;
const SUMMARY_SHOULD = 10;

export type AnalyzeRequest = {
  workspaceDir: string;
  configPath?: string | null;
  prod?: string | null;
  candidate?: string | null;
  outputDir?: string | null;
  outputRoot?: string | null;
  dryRun?: boolean;
};

export type AnalyzeResult = {
  exitCode: 0 | 2 | 3;
  summary: ImpactSummary;
  selection: SelectedTests | null;
};

export async function analyzeRelease(request: AnalyzeRequest): Promise<AnalyzeResult> {
  const loaded = loadImpactConfig(request.workspaceDir, request.configPath);
  if (!loaded.config || loaded.errors.length) return failed(2, loaded.errors);
  const config = loaded.config;
  const unknowns = [...loaded.warnings];
  if (config.releaseManifest && (request.prod || request.candidate)) {
    unknowns.push("Release manifest is set, so prod and candidate overrides were ignored.");
  }
  let manifest = null;
  if (config.releaseManifest) {
    const read = readManifest(request.workspaceDir, config.releaseManifest);
    if (read.error || !read.manifest) return failed(2, [read.error ?? "releaseManifest could not be read"]);
    manifest = read.manifest;
  }
  const collected = await collectRelease(
    request.workspaceDir,
    config,
    manifest,
    manifest ? null : request.prod ?? null,
    manifest ? null : request.candidate ?? null,
    config.policy?.maxDetailFiles ?? DEFAULT_MAX_DETAIL_FILES,
  );
  if (collected.missingGit) return failed(2, ["git was not found on PATH"]);
  const paths = outputPaths(config, request.outputDir);
  if (!paths) return failed(2, ["--output must stay inside the workspace"]);
  const indexed = await indexAutomation(
    collected.repos,
    config.policy?.maxTestFiles ?? DEFAULT_MAX_TEST_FILES,
    config.ignore ?? [],
  );
  const contractPaths = contractGlobs(config);
  const scored = scoreRelease({
    changes: collected.changes,
    policyChanges: collected.policyChanges,
    changedFileCount: collected.changedFileCount,
    tests: indexed.tests,
    explicit: config.mapping?.explicit ?? [],
    contractPaths,
    commitTickets: collected.commitTickets,
    fullRegressionGlobs: config.policy?.fullRegression ?? null,
    minMappingCoverage: config.policy?.minMappingCoverage ?? null,
    maxChangedFiles: config.policy?.maxChangedFiles ?? DEFAULT_MAX_CHANGED_FILES,
  });
  const reasons = [...scored.fullRegressionReasons];
  if (indexed.failed) reasons.push("The test adapter failed or found no tests, so the selection is incomplete.");
  if (collected.repos.some((repo) => repo.error)) reasons.push("One or more repos could not be diffed.");
  const selection = buildSelection(config, collected.repos, scored, [...scored.unknowns, ...unknowns, ...collected.unknowns, ...indexed.unknowns], reasons);
  if (!request.dryRun) {
    const written = writeOutputs(request.workspaceDir, paths, selection, request.outputRoot);
    if (written) return failed(2, [written]);
  }
  const sourceChangedFiles = collected.policyChanges.filter((change) => change.role !== "automation").length;
  return {
    exitCode: selection.fullRegression ? 3 : 0,
    summary: toSummary(
      selection,
      collected.commits,
      collected.policyChanges.map((change) => change.workspacePath),
      sourceChangedFiles,
      paths,
      [],
    ),
    selection,
  };
}

export async function doctorImpact(workspaceDir: string, configPath?: string | null): Promise<{ exitCode: number; text: string }> {
  const loaded = loadImpactConfig(workspaceDir, configPath);
  const lines: string[] = [];
  if (loaded.path) lines.push(`Config: ${loaded.path}`);
  for (const warning of loaded.warnings) lines.push(`warning: ${warning}`);
  if (!loaded.config || loaded.errors.length) {
    for (const error of loaded.errors) lines.push(`error: ${error}`);
    return { exitCode: 2, text: lines.join("\n") };
  }
  const config = loaded.config;
  let manifest = null;
  if (config.releaseManifest) {
    const read = readManifest(workspaceDir, config.releaseManifest);
    if (read.error || !read.manifest) {
      lines.push(`error: ${read.error ?? "releaseManifest could not be read"}`);
      return { exitCode: 2, text: lines.join("\n") };
    }
    manifest = read.manifest;
  }
  const collected = await collectRelease(
    workspaceDir,
    config,
    manifest,
    null,
    null,
    config.policy?.maxDetailFiles ?? DEFAULT_MAX_DETAIL_FILES,
  );
  if (collected.missingGit) {
    lines.push("error: git was not found on PATH");
    return { exitCode: 2, text: lines.join("\n") };
  }
  const indexed = await indexAutomation(
    collected.repos,
    config.policy?.maxTestFiles ?? DEFAULT_MAX_TEST_FILES,
    config.ignore ?? [],
  );
  for (const unknown of indexed.unknowns) {
    lines.push(`${indexed.failed ? "error" : "warning"}: ${unknown}`);
  }
  lines.push(`Repos: ${config.repos.length}`);
  lines.push(`Mappings: ${config.mapping?.explicit?.length ?? 0}`);
  let invalid = indexed.failed;
  for (const repo of collected.repos) {
    if (repo.error) {
      invalid = true;
      lines.push(`error: ${repo.error}`);
      continue;
    }
    const tests = repo.role === "automation" ? indexed.counts[repo.id] ?? 0 : null;
    const adapter = repo.role === "automation" ? repo.framework || "generic" : repo.role;
    lines.push(
      tests == null
        ? `${repo.id} (${adapter}): prod ${short(repo.prodSha)} candidate ${short(repo.candidateSha)}`
        : `${repo.id} (${adapter}): ${tests} tests, prod ${short(repo.prodSha)} candidate ${short(repo.candidateSha)}`,
    );
  }
  lines.push(`Report: ${config.outputs.report}`);
  lines.push(`Selection: ${config.outputs.selection}`);
  for (const [label, relative] of [
    ["Report", config.outputs.report],
    ["Selection", config.outputs.selection],
  ] as const) {
    const issue = outputDirectoryIssue(workspaceDir, relative);
    if (issue) {
      invalid = true;
      lines.push(`error: ${label.toLowerCase()} ${issue}`);
    }
  }
  lines.push(invalid ? "Fix the errors above before analyze." : "OK");
  return { exitCode: invalid ? 2 : 0, text: lines.join("\n") };
}

function outputDirectoryIssue(workspaceDir: string, relative: string): string | null {
  const file = path.resolve(workspaceDir, relative);
  let directory = path.dirname(file);
  while (!fs.existsSync(directory) && path.dirname(directory) !== directory) {
    directory = path.dirname(directory);
  }
  if (!fs.existsSync(directory)) return "has no existing parent directory";
  try {
    if (!fs.statSync(directory).isDirectory()) return "has a parent that is not a directory";
  } catch {
    return "cannot be inspected";
  }
  return null;
}

export function explainImpact(
  workspaceDir: string,
  id: string,
  configPath?: string | null,
): { exitCode: number; text: string } {
  let selection: SelectedTests | null;
  try {
    selection = readImpactSelection(workspaceDir, configPath);
  } catch (error) {
    return { exitCode: 2, text: error instanceof Error ? error.message : String(error) };
  }
  if (!selection) return { exitCode: 2, text: "No selection file was found. Run analyze first." };
  const found = [...selection.mustRun, ...selection.shouldRun, ...(selection.optionalRun ?? [])].filter(
    (test) => test.id === id || test.name === id,
  );
  if (found.length === 0) return { exitCode: 2, text: `${id} is not in the selection.` };
  const lines = found.flatMap((test) => [test.id, test.name, test.file, test.reason, ...test.evidence.map((cite) => `evidence: ${cite}`), ""]);
  return { exitCode: 0, text: lines.join("\n").trimEnd() };
}

export function readImpactSelection(workspaceDir: string, configPath?: string | null): SelectedTests | null {
  const loaded = loadImpactConfig(workspaceDir, configPath);
  if (loaded.path && loaded.errors.length) throw new Error(loaded.errors[0]);
  const relative = loaded.config?.outputs.selection ?? `${IMPACT_OUTPUT_ROOT}/selected-tests.json`;
  const file = path.resolve(workspaceDir, relative);
  if (!isInsideWorkspace(workspaceDir, file)) throw new Error("Selection path is outside the workspace");
  if (!fs.existsSync(file)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("Selection file is not valid JSON");
  }
  if (!isSelection(parsed)) throw new Error("Selection file is missing the release impact fields");
  return parsed;
}

function buildSelection(
  config: ImpactConfig,
  repos: ResolvedRepo[],
  scored: ReturnType<typeof scoreRelease>,
  unknowns: string[],
  reasons: string[],
): SelectedTests {
  const release = { prod: {} as Record<string, string>, candidate: {} as Record<string, string> };
  for (const repo of repos) {
    if (repo.prodSha) release.prod[repo.id] = repo.prodSha;
    if (repo.candidateSha) release.candidate[repo.id] = repo.candidateSha;
  }
  const fullRegression = reasons.length > 0;
  const mustRun = scored.mustRun;
  return {
    release,
    mustRun,
    shouldRun: scored.shouldRun,
    optionalRun: scored.optionalRun,
    newScenarios: scored.newScenarios,
    risks: scored.risks,
    fullRegression,
    fullRegressionReasons: [...new Set(reasons)],
    unknowns: [...new Set(unknowns)],
    selectionFormat: config.outputs.selectionFormat,
    selectionText: renderSelection(mustRun, config.outputs.selectionFormat).trim(),
  };
}

function toSummary(
  selection: SelectedTests,
  commits: string[],
  paths: string[],
  sourceChangedFiles: number,
  outputs: { report: string; selection: string },
  errors: string[],
): ImpactSummary {
  return {
    ok: errors.length === 0,
    exitCode: errors.length ? 2 : selection.fullRegression ? 3 : 0,
    errors,
    fullRegression: selection.fullRegression,
    fullRegressionReasons: selection.fullRegressionReasons.slice(0, 10),
    changedFiles: paths.length,
    sourceChangedFiles,
    commits: commits.slice(0, 20),
    paths: paths.slice(0, 40),
    areas: areasOf(selection),
    mustRun: selection.mustRun.slice(0, SUMMARY_MUST),
    mustRunTotal: selection.mustRun.length,
    shouldRun: selection.shouldRun.slice(0, SUMMARY_SHOULD),
    shouldRunTotal: selection.shouldRun.length,
    newScenarios: selection.newScenarios.slice(0, 10),
    risks: selection.risks.slice(0, 10),
    unknowns: selection.unknowns.slice(0, 10),
    report: outputs.report,
    selection: outputs.selection,
    selectionText: selection.selectionText,
  };
}

function areasOf(selection: SelectedTests): ImpactSummary["areas"] {
  const counts = new Map<string, { must: number; should: number }>();
  const add = (file: string, tier: "must" | "should") => {
    const folder = file.split("/").slice(0, -1).join("/") || ".";
    const row = counts.get(folder) ?? { must: 0, should: 0 };
    row[tier] += 1;
    counts.set(folder, row);
  };
  for (const test of selection.mustRun) add(test.file, "must");
  for (const test of selection.shouldRun) add(test.file, "should");
  return [...counts.entries()]
    .map(([folder, row]) => ({ folder, must: row.must, should: row.should }))
    .sort((a, b) => b.must - a.must || b.should - a.should || a.folder.localeCompare(b.folder))
    .slice(0, 8);
}

function failed(exitCode: 2, errors: string[]): AnalyzeResult {
  return {
    exitCode,
    selection: null,
    summary: {
      ok: false,
      exitCode,
      errors,
      fullRegression: false,
      fullRegressionReasons: [],
      changedFiles: 0,
      sourceChangedFiles: 0,
      commits: [],
      paths: [],
      areas: [],
      mustRun: [],
      mustRunTotal: 0,
      shouldRun: [],
      shouldRunTotal: 0,
      newScenarios: [],
      risks: [],
      unknowns: [],
      report: null,
      selection: null,
      selectionText: null,
    },
  };
}

function outputPaths(config: ImpactConfig, outputDir?: string | null): { report: string; selection: string } | null {
  if (!outputDir) return { report: config.outputs.report, selection: config.outputs.selection };
  const relative = outputDir.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!relative || path.isAbsolute(outputDir) || /^[A-Za-z]:/.test(outputDir) || relative.split("/").includes("..")) return null;
  return { report: `${relative}/impact-report.md`, selection: `${relative}/selected-tests.json` };
}

function writeOutputs(
  workspaceDir: string,
  outputs: { report: string; selection: string },
  selection: SelectedTests,
  outputRoot?: string | null,
): string | null {
  try {
    if (outputRoot) {
      for (const relative of [outputs.report, outputs.selection]) {
        if (!pathUnderRoot(relative, outputRoot)) {
          return `Output must stay under ${outputRoot.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}/: ${relative}`;
        }
      }
    }
    writeText(workspaceDir, outputs.report, renderReport(selection));
    writeText(workspaceDir, outputs.selection, `${JSON.stringify(selection, null, 2)}\n`);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function writeText(workspaceDir: string, relative: string, content: string): void {
  if (relative.split("/").some((part) => part === "..") || path.isAbsolute(relative)) {
    throw new Error(`Output is outside the workspace: ${relative}`);
  }
  const file = path.resolve(workspaceDir, relative);
  if (!isInsideWorkspace(workspaceDir, file)) throw new Error(`Output is outside the workspace: ${relative}`);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const realWorkspace = fs.realpathSync(workspaceDir);
  const realDirectory = fs.realpathSync(directory);
  if (!isInsideWorkspace(realWorkspace, realDirectory)) {
    throw new Error(`Output is outside the workspace: ${relative}`);
  }
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, content, "utf8");
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // The temporary file is already gone or cannot be removed.
    }
    throw error;
  }
}

function pathUnderRoot(relative: string, root: string): boolean {
  const value = relative.replace(/\\/g, "/").replace(/^\.\//, "");
  const base = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return value === base || value.startsWith(`${base}/`);
}

function contractGlobs(config: ImpactConfig): string[] {
  const globs: string[] = [];
  for (const contract of config.mapping?.contracts ?? []) {
    const repo = config.repos.find((item) => item.id === contract.repo);
    if (!repo) continue;
    const relative = contract.path.replace(/\\/g, "/").replace(/^\.\//, "");
    globs.push(`${repo.id}/${relative}`);
    globs.push(repo.path === "." ? relative : `${repo.path}/${relative}`);
  }
  return globs;
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "missing";
}

function isSelection(value: unknown): value is SelectedTests {
  if (!isRecord(value)) return false;
  const arrays = ["mustRun", "shouldRun", "optionalRun", "newScenarios", "risks", "fullRegressionReasons", "unknowns"];
  if (!arrays.every((key) => Array.isArray(value[key]))) return false;
  if (typeof value.fullRegression !== "boolean") return false;
  if (typeof value.selectionFormat !== "string" || typeof value.selectionText !== "string") return false;
  const release = value.release;
  return isRecord(release) && isRecord(release.prod) && isRecord(release.candidate);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
