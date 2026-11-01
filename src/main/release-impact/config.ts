import fs from "fs";
import path from "path";
import type {
  ContractRule,
  ImpactConfig,
  ImpactOutputs,
  MappingRule,
  RepoConfig,
  RepoRole,
  SelectionFormat,
} from "../../shared/release-impact/types";
import { IMPACT_OUTPUT_ROOT, isImpactOutputPath } from "../../shared/release-impact/paths";
import { isInsideWorkspace } from "../../tools/workspace";

const ROOT_KEYS = new Set([
  "schemaVersion",
  "team",
  "releaseManifest",
  "repos",
  "ignore",
  "mapping",
  "policy",
  "outputs",
  "jira",
]);
const REPO_KEYS = new Set([
  "id",
  "path",
  "role",
  "language",
  "framework",
  "adapterPath",
  "testGlobs",
  "caseIdPattern",
  "prod",
  "candidate",
]);
const MAPPING_KEYS = new Set(["explicit", "contracts"]);
const RULE_KEYS = new Set(["match", "tests"]);
const CONTRACT_KEYS = new Set(["repo", "type", "path"]);
const POLICY_KEYS = new Set([
  "fullRegression",
  "minMappingCoverage",
  "maxChangedFiles",
  "maxDetailFiles",
  "maxTestFiles",
  "allowCustomAdapters",
]);
const OUTPUT_KEYS = new Set(["report", "selection", "selectionFormat"]);
const JIRA_KEYS = new Set(["enabled", "projectKeys"]);
const ROLES = new Set<RepoRole>(["source", "automation", "contract"]);
const FORMATS = new Set<SelectionFormat>([
  "file-list",
  "playwright-grep",
  "testng-xml",
  "cucumber-tags",
  "junit",
  "json",
]);
const SECRET = /ghp_|github_pat_|eyJ/;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export type ConfigLoad = {
  path: string | null;
  config: ImpactConfig | null;
  errors: string[];
  warnings: string[];
};

export type ReleaseManifest = {
  prod: Record<string, string>;
  candidate: Record<string, string>;
};

export function loadImpactConfig(workspaceDir: string, requested?: string | null): ConfigLoad {
  const found = findConfigFile(workspaceDir, requested);
  if (found.error) return { path: null, config: null, errors: [found.error], warnings: [] };
  if (!found.file) return { path: null, config: null, errors: ["No release-impact config was found"], warnings: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(found.file, "utf8"));
  } catch {
    return { path: found.relative, config: null, errors: [`${found.relative} is not valid JSON`], warnings: [] };
  }
  const result = validateImpactConfig(workspaceDir, parsed);
  return { path: found.relative, config: result.config, errors: result.errors, warnings: result.warnings };
}

export function validateImpactConfig(
  workspaceDir: string,
  value: unknown,
): { config: ImpactConfig | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) return { config: null, errors: ["Config must be a JSON object"], warnings };
  rejectUnknown(value, ROOT_KEYS, "config", errors);
  if (scanSecrets(value)) errors.push("Config contains a secret-looking value");
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (value.team != null && typeof value.team !== "string") errors.push("team must be a string");

  let releaseManifest: string | undefined;
  if (value.releaseManifest != null) {
    const relative = relativeInsideConfig(workspaceDir, value.releaseManifest, "releaseManifest", errors);
    if (relative) releaseManifest = relative;
  }

  const repos = readRepos(workspaceDir, value.repos, errors);
  const ignore = readStringList(value.ignore, "ignore", errors);
  const mapping = readMapping(workspaceDir, value.mapping, errors);
  const policy = readPolicy(value.policy, errors);
  const outputs = readOutputs(workspaceDir, value.outputs, errors);
  const jira = readJira(value.jira, errors);

  if (repos) {
    const ids = new Set<string>();
    for (const repo of repos) {
      if (ids.has(repo.id)) errors.push(`Duplicate repo id ${repo.id}`);
      ids.add(repo.id);
      if (repo.adapterPath) {
        errors.push(
          `${repo.id} sets adapterPath. Custom adapter modules are not loaded. Use framework generic or playwright.`,
        );
      }
    }
    if (mapping?.contracts) {
      for (const contract of mapping.contracts) {
        if (!ids.has(contract.repo)) errors.push(`Contract repo ${contract.repo} is not in repos`);
      }
    }
    if (jira?.projectKeys && !repos.some((repo) => repo.role === "source")) {
      warnings.push("jira.projectKeys is set and no source repo is configured");
    }
  }
  if (jira?.enabled) warnings.push("jira.enabled is stored. The engine reads ticket keys from the diff and does not call Jira.");

  if (errors.length || !repos || !outputs) return { config: null, errors, warnings };
  const config: ImpactConfig = {
    schemaVersion: 1,
    repos,
    outputs,
  };
  if (typeof value.team === "string" && value.team.trim()) config.team = value.team.trim();
  if (releaseManifest) config.releaseManifest = releaseManifest;
  if (ignore) config.ignore = ignore;
  if (mapping) config.mapping = mapping;
  if (policy) config.policy = policy;
  if (jira) config.jira = jira;
  return { config, errors, warnings };
}

export function readManifest(workspaceDir: string, relative: string): { manifest: ReleaseManifest | null; error: string | null } {
  const file = path.resolve(workspaceDir, relative);
  if (!isInsideWorkspace(workspaceDir, file)) return { manifest: null, error: "releaseManifest is outside the workspace" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { manifest: null, error: "releaseManifest is missing or is not valid JSON" };
  }
  if (!isRecord(parsed) || !isRecord(parsed.prod) || !isRecord(parsed.candidate)) {
    return { manifest: null, error: "releaseManifest needs prod and candidate objects" };
  }
  const prod = stringMap(parsed.prod);
  const candidate = stringMap(parsed.candidate);
  if (!prod || !candidate) return { manifest: null, error: "releaseManifest refs must be strings" };
  return { manifest: { prod, candidate }, error: null };
}

function findConfigFile(
  workspaceDir: string,
  requested?: string | null,
): { file: string | null; relative: string | null; error: string | null } {
  if (requested) {
    const relative = relativeInsideConfig(workspaceDir, requested, "--config", []);
    if (!relative) return { file: null, relative: null, error: "--config must stay inside the workspace" };
    const file = path.resolve(workspaceDir, relative);
    if (!fs.existsSync(file)) return { file: null, relative, error: `Config was not found: ${relative}` };
    return { file, relative, error: null };
  }
  for (const relative of [".release-impact/config.json", "release-impact.config.json"]) {
    const file = path.resolve(workspaceDir, relative);
    if (fs.existsSync(file) && isInsideWorkspace(workspaceDir, file)) return { file, relative, error: null };
  }
  return { file: null, relative: null, error: null };
}

function readRepos(workspaceDir: string, value: unknown, errors: string[]): RepoConfig[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("repos must be a non-empty array");
    return null;
  }
  const repos: RepoConfig[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      errors.push("Each repo must be an object");
      continue;
    }
    rejectUnknown(item, REPO_KEYS, "repo", errors);
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!ID_PATTERN.test(id)) errors.push("Each repo id must be 1-80 letters, numbers, dots, underscores, or dashes");
    const repoPath = typeof item.path === "string" ? relativeInsideConfig(workspaceDir, item.path, `repo ${id || "path"}`, errors) : "";
    if (typeof item.path !== "string") errors.push("Each repo path must be a string");
    const role = item.role;
    if (typeof role !== "string" || !ROLES.has(role as RepoRole)) errors.push(`${id || "repo"} role must be source, automation, or contract`);
    if (!id || !repoPath || typeof role !== "string" || !ROLES.has(role as RepoRole)) continue;
    const repo: RepoConfig = { id, path: repoPath, role: role as RepoRole };
    const language = optionalText(item.language, `${id}.language`, errors);
    const framework = optionalText(item.framework, `${id}.framework`, errors);
    const adapterPath = item.adapterPath == null ? undefined : relativeInsideConfig(workspaceDir, item.adapterPath, `${id}.adapterPath`, errors);
    const testGlobs = readStringList(item.testGlobs, `${id}.testGlobs`, errors);
    const caseIdPattern = optionalText(item.caseIdPattern, `${id}.caseIdPattern`, errors);
    const prod = optionalText(item.prod, `${id}.prod`, errors);
    const candidate = optionalText(item.candidate, `${id}.candidate`, errors);
    if (language) repo.language = language;
    if (framework) repo.framework = framework;
    if (adapterPath) repo.adapterPath = adapterPath;
    if (testGlobs) repo.testGlobs = testGlobs;
    if (caseIdPattern) {
      if (caseIdPattern.length > 80) errors.push(`${id}.caseIdPattern is too long`);
      else {
        try {
          new RegExp(caseIdPattern);
          repo.caseIdPattern = caseIdPattern;
        } catch {
          errors.push(`${id}.caseIdPattern is not a valid regex`);
        }
      }
    }
    if (prod) repo.prod = prod;
    if (candidate) repo.candidate = candidate;
    repos.push(repo);
  }
  return repos;
}

function readMapping(workspaceDir: string, value: unknown, errors: string[]): ImpactConfig["mapping"] | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    errors.push("mapping must be an object");
    return undefined;
  }
  rejectUnknown(value, MAPPING_KEYS, "mapping", errors);
  const mapping: ImpactConfig["mapping"] = {};
  if (value.explicit != null) {
    if (!Array.isArray(value.explicit)) errors.push("mapping.explicit must be an array");
    else {
      const rules: MappingRule[] = [];
      for (const item of value.explicit) {
        if (!isRecord(item)) {
          errors.push("Each mapping rule must be an object");
          continue;
        }
        rejectUnknown(item, RULE_KEYS, "mapping rule", errors);
        const match = typeof item.match === "string" ? item.match.trim() : "";
        const tests = readStringList(item.tests, "mapping.tests", errors);
        if (!match || !tests) errors.push("Each mapping rule needs match and tests");
        else rules.push({ match, tests });
      }
      mapping.explicit = rules;
    }
  }
  if (value.contracts != null) {
    if (!Array.isArray(value.contracts)) errors.push("mapping.contracts must be an array");
    else {
      const contracts: ContractRule[] = [];
      for (const item of value.contracts) {
        if (!isRecord(item)) {
          errors.push("Each contract must be an object");
          continue;
        }
        rejectUnknown(item, CONTRACT_KEYS, "contract", errors);
        const repo = typeof item.repo === "string" ? item.repo.trim() : "";
        const type = typeof item.type === "string" ? item.type.trim() : "";
        const contractPath = typeof item.path === "string"
          ? relativeInsideConfig(workspaceDir, item.path, `contract ${repo || "path"}.path`, errors)
          : "";
        if (!repo || !type || !contractPath) errors.push("Each contract needs repo, type, and a path inside the workspace");
        else contracts.push({ repo, type, path: contractPath });
      }
      mapping.contracts = contracts;
    }
  }
  return mapping;
}

function readPolicy(value: unknown, errors: string[]): ImpactConfig["policy"] | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    errors.push("policy must be an object");
    return undefined;
  }
  rejectUnknown(value, POLICY_KEYS, "policy", errors);
  const policy: ImpactConfig["policy"] = {};
  const fullRegression = readStringList(value.fullRegression, "policy.fullRegression", errors);
  if (fullRegression) policy.fullRegression = fullRegression;
  if (value.minMappingCoverage != null) {
    if (typeof value.minMappingCoverage !== "number" || value.minMappingCoverage < 0 || value.minMappingCoverage > 1) {
      errors.push("policy.minMappingCoverage must be a number from 0 to 1");
    } else policy.minMappingCoverage = value.minMappingCoverage;
  }
  if (value.maxChangedFiles != null) {
    if (typeof value.maxChangedFiles !== "number" || !Number.isInteger(value.maxChangedFiles) || value.maxChangedFiles < 1) {
      errors.push("policy.maxChangedFiles must be a positive integer");
    } else policy.maxChangedFiles = value.maxChangedFiles;
  }
  if (value.maxDetailFiles != null) {
    if (typeof value.maxDetailFiles !== "number" || !Number.isInteger(value.maxDetailFiles) || value.maxDetailFiles < 1) {
      errors.push("policy.maxDetailFiles must be a positive integer");
    } else policy.maxDetailFiles = value.maxDetailFiles;
  }
  if (value.maxTestFiles != null) {
    if (typeof value.maxTestFiles !== "number" || !Number.isInteger(value.maxTestFiles) || value.maxTestFiles < 1) {
      errors.push("policy.maxTestFiles must be a positive integer");
    } else policy.maxTestFiles = value.maxTestFiles;
  }
  if (value.allowCustomAdapters != null) {
    if (typeof value.allowCustomAdapters !== "boolean") errors.push("policy.allowCustomAdapters must be a boolean");
    else policy.allowCustomAdapters = value.allowCustomAdapters;
  }
  return policy;
}

function readOutputs(workspaceDir: string, value: unknown, errors: string[]): ImpactOutputs | null {
  if (!isRecord(value)) {
    errors.push("outputs is required");
    return null;
  }
  rejectUnknown(value, OUTPUT_KEYS, "outputs", errors);
  const report = typeof value.report === "string" ? relativeInsideConfig(workspaceDir, value.report, "outputs.report", errors) : "";
  const selection = typeof value.selection === "string" ? relativeInsideConfig(workspaceDir, value.selection, "outputs.selection", errors) : "";
  const format = value.selectionFormat;
  if (typeof value.report !== "string") errors.push("outputs.report is required");
  if (typeof value.selection !== "string") errors.push("outputs.selection is required");
  if (typeof format !== "string" || !FORMATS.has(format as SelectionFormat)) {
    errors.push("outputs.selectionFormat must be file-list, playwright-grep, testng-xml, cucumber-tags, junit, or json");
  }
  if (report && !isImpactOutputPath(report)) errors.push(`outputs.report must be under ${IMPACT_OUTPUT_ROOT}/`);
  if (selection && !isImpactOutputPath(selection)) errors.push(`outputs.selection must be under ${IMPACT_OUTPUT_ROOT}/`);
  if (report && selection && report.toLowerCase() === selection.toLowerCase()) {
    errors.push("outputs.report and outputs.selection must be different files");
  }
  if (!report || !selection || typeof format !== "string" || !FORMATS.has(format as SelectionFormat)) return null;
  return { report, selection, selectionFormat: format as SelectionFormat };
}

function readJira(value: unknown, errors: string[]): ImpactConfig["jira"] | undefined {
  if (value == null) return undefined;
  if (!isRecord(value)) {
    errors.push("jira must be an object");
    return undefined;
  }
  rejectUnknown(value, JIRA_KEYS, "jira", errors);
  const jira: ImpactConfig["jira"] = {};
  if (value.enabled != null) {
    if (typeof value.enabled !== "boolean") errors.push("jira.enabled must be a boolean");
    else jira.enabled = value.enabled;
  }
  const projectKeys = readStringList(value.projectKeys, "jira.projectKeys", errors);
  if (projectKeys) {
    for (const key of projectKeys) {
      if (!/^[A-Z][A-Z0-9]{1,10}$/.test(key)) errors.push(`Jira project key is not valid: ${key}`);
    }
    jira.projectKeys = projectKeys;
  }
  return jira;
}

function readStringList(value: unknown, label: string, errors: string[]): string[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    errors.push(`${label} must be an array of strings`);
    return undefined;
  }
  return value.map((item) => item.trim());
}

function optionalText(value: unknown, label: string, errors: string[]): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a string`);
    return undefined;
  }
  return value.trim();
}

function relativeInsideConfig(workspaceDir: string, value: unknown, label: string, errors: string[]): string {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a relative path`);
    return "";
  }
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || normalized.startsWith("/")) {
    errors.push(`${label} must be a relative path`);
    return "";
  }
  if (normalized.split("/").some((part) => part === "..")) {
    errors.push(`${label} must stay inside the workspace`);
    return "";
  }
  const resolved = path.resolve(workspaceDir, normalized);
  if (!isInsideWorkspace(workspaceDir, resolved)) {
    errors.push(`${label} must stay inside the workspace`);
    return "";
  }
  return normalized;
}

function rejectUnknown(record: Record<string, unknown>, allowed: Set<string>, label: string, errors: string[]): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) errors.push(`Unknown ${label} field "${key}"`);
  }
}

function scanSecrets(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value === "string") return SECRET.test(value);
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const items = Array.isArray(value) ? value : Object.values(value);
  return items.some((item) => scanSecrets(item, seen));
}

function stringMap(value: Record<string, unknown>): Record<string, string> | null {
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" || !item.trim()) return null;
    result[key] = item.trim();
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
