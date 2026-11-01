import type { ImpactRisk, NewScenario, RepoRole, SelectedTest, TestTier } from "./types";

export const DEFAULT_MAX_CHANGED_FILES = 400;

// Suggested safety paths. They apply only when policy.fullRegression lists them.
export const DEFAULT_FULL_REGRESSION = [
  "**/auth/**",
  "**/security/**",
  "**/payments/**",
  "**/migrations/**",
  "**/openapi*.yaml",
  "**/openapi*.yml",
  "**/*.proto",
  "**/pom.xml",
  "**/package.json",
  "**/package-lock.json",
];

const STOP_TOKENS = new Set([
  "src",
  "main",
  "test",
  "tests",
  "java",
  "spec",
  "index",
  "app",
  "core",
  "source",
  "automation",
]);

export type ChangeSignals = {
  endpoints: string[];
  selectors: string[];
  symbols: string[];
  tickets: string[];
  removedSelectors: string[];
  addedSelectors: string[];
};

export type ScoreChange = {
  idPath: string;
  workspacePath: string;
  role: "source" | "automation" | "contract";
  status: string;
  line: number;
  signals: ChangeSignals;
};

export type ScoreTest = {
  id: string;
  name: string;
  idPath: string;
  workspacePath: string;
  suite: string;
  line: number;
  skipped: boolean;
  signals: ChangeSignals;
};

export type ScoreRule = {
  match: string;
  tests: string[];
};

export type PolicyChange = {
  idPath: string;
  workspacePath: string;
  role: RepoRole;
};

export type ScoreInput = {
  changes: ScoreChange[];
  policyChanges?: PolicyChange[];
  changedFileCount: number;
  tests: ScoreTest[];
  explicit: ScoreRule[];
  contractPaths: string[];
  commitTickets: string[];
  fullRegressionGlobs: string[] | null;
  minMappingCoverage: number | null;
  maxChangedFiles: number;
};

export type ScoreOutput = {
  mustRun: SelectedTest[];
  shouldRun: SelectedTest[];
  optionalRun: SelectedTest[];
  newScenarios: NewScenario[];
  risks: ImpactRisk[];
  fullRegression: boolean;
  fullRegressionReasons: string[];
  unknowns: string[];
  mappingCoverage: number;
};

type Hit = {
  test: ScoreTest;
  score: number;
  tier: TestTier;
  reasons: string[];
  evidence: string[];
};

export function matchGlob(glob: string, file: string): boolean {
  const target = file.replace(/\\/g, "/").replace(/^\.\//, "");
  const pattern = glob.replace(/\\/g, "/");
  return globToRegExp(pattern).test(target);
}

const BROAD_MAP_TESTS = 40;
const BROAD_MAP_SHARE = 0.25;

export function scoreRelease(input: ScoreInput): ScoreOutput {
  const globs = input.fullRegressionGlobs ?? [];
  const reasons: string[] = [];
  const unknowns: string[] = [];
  const policyChanges = input.policyChanges ?? input.changes;
  const sourcePolicyChanges = policyChanges.filter((change) => change.role !== "automation");
  const changedFileCount = input.policyChanges ? sourcePolicyChanges.length : input.changedFileCount;
  if (changedFileCount > input.maxChangedFiles) {
    unknowns.push(
      `Source/contract changed files (${changedFileCount}) exceed the review limit of ${input.maxChangedFiles}. The matched tests are still the selection.`,
    );
  }
  reasons.push(...groupedPathReasons(sourcePolicyChanges, globs, "Full regression path"));
  reasons.push(...groupedPathReasons(sourcePolicyChanges, input.contractPaths, "Contract file"));

  const broadRules = input.explicit.filter((rule) => isBroadMap(rule, input.tests));
  const broadKeys = new Set(broadRules.map(ruleKey));
  for (const rule of broadRules) {
    const reach = testsForRule(rule, input.tests).length;
    unknowns.push(
      `Mapping ${rule.match} matches ${reach} of ${input.tests.length} tests. Those tests are selected only when a signal also matches. Narrow the map to a folder.`,
    );
  }

  const hits: Hit[] = [];
  for (const test of input.tests) {
    const hit = scoreTest(test, input.changes, input.explicit, broadKeys);
    if (hit) hits.push(hit);
  }
  hits.sort((a, b) => b.score - a.score || a.test.workspacePath.localeCompare(b.test.workspacePath) || a.test.name.localeCompare(b.test.name));

  const mustRun = hits.filter((hit) => hit.tier === "must").map(toSelected);
  const shouldRun = hits.filter((hit) => hit.tier === "should").map(toSelected);
  const optionalRun = hits.filter((hit) => hit.tier === "optional").map(toSelected);

  const sourceChanges = input.changes.filter((change) => change.role !== "automation");
  const matched = sourceChanges.filter((change) =>
    hits.some((hit) => hit.tier === "must" && hit.evidence.some((item) => evidenceMatchesPath(item, change.workspacePath))),
  );
  const mappingCoverage = sourceChanges.length === 0 ? 1 : matched.length / sourceChanges.length;
  const uncovered = uncoveredNote(sourceChanges, hits);
  if (uncovered) unknowns.push(uncovered);
  if (input.minMappingCoverage != null && sourceChanges.length > 0 && mappingCoverage < input.minMappingCoverage) {
    unknowns.push(
      `Mapping coverage ${mappingCoverage.toFixed(2)} is below ${input.minMappingCoverage.toFixed(2)}. The must-run list is still the selection.`,
    );
  }

  const knownTickets = new Set<string>();
  for (const test of input.tests) {
    for (const ticket of test.signals.tickets) knownTickets.add(ticket);
    const titleTicket = test.name.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [];
    for (const ticket of titleTicket) knownTickets.add(ticket);
  }
  const seenTickets = new Set<string>();
  const newScenarios: NewScenario[] = [];
  for (const ticket of input.commitTickets) {
    if (knownTickets.has(ticket) || seenTickets.has(ticket)) continue;
    seenTickets.add(ticket);
    newScenarios.push({
      title: `Cover ${ticket}`,
      source: ticket,
      reason: `The diff mentions ${ticket} and no indexed test does.`,
    });
  }

  return {
    mustRun,
    shouldRun,
    optionalRun,
    newScenarios,
    risks: selectorRisks(input.changes, input.tests),
    fullRegression: reasons.length > 0,
    fullRegressionReasons: unique(reasons),
    unknowns,
    mappingCoverage,
  };
}

function groupedPathReasons(changes: PolicyChange[], globs: string[], label: string): string[] {
  const reasons: string[] = [];
  for (const glob of globs) {
    const matched = changes.filter((change) => matchesPaths(glob, change));
    if (matched.length === 0) continue;
    const count = matched.length === 1 ? "" : ` (${matched.length} files)`;
    reasons.push(`${label} ${glob} changed${count}: ${matched[0].workspacePath}`);
  }
  return reasons;
}

function isBroadMap(rule: ScoreRule, tests: ScoreTest[]): boolean {
  if (tests.length === 0) return false;
  const reach = testsForRule(rule, tests).length;
  return reach > BROAD_MAP_TESTS && reach / tests.length > BROAD_MAP_SHARE;
}

function testsForRule(rule: ScoreRule, tests: ScoreTest[]): ScoreTest[] {
  return tests.filter((test) => rule.tests.some((glob) => matchesTest(glob, test)));
}

function ruleKey(rule: ScoreRule): string {
  return `${rule.match}\0${rule.tests.join("\0")}`;
}

function uncoveredNote(changes: ScoreChange[], hits: Hit[]): string | null {
  const covered = new Set<string>();
  for (const hit of hits) {
    if (hit.tier !== "must") continue;
    for (const item of hit.evidence) covered.add(item.replace(/:\d+$/, ""));
  }
  const folders = new Map<string, number>();
  for (const change of changes) {
    if (covered.has(change.workspacePath)) continue;
    const folder = change.workspacePath.split("/").slice(0, -1).join("/") || ".";
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  if (folders.size === 0) return null;
  const top = [...folders.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6);
  const text = top.map(([folder, count]) => `${folder} (${count})`).join(", ");
  const rest = folders.size - top.length;
  const more = rest > 0 ? `, and ${rest} more folders` : "";
  return `Uncovered source folders: ${text}${more}.`;
}

function scoreTest(test: ScoreTest, changes: ScoreChange[], explicit: ScoreRule[], broadKeys: Set<string>): Hit | null {
  let score = 0;
  const reasons: string[] = [];
  const evidence: string[] = [];
  const remember = (path: string, line: number) => {
    const cite = line > 0 ? `${path}:${line}` : path;
    if (!evidence.includes(cite)) evidence.push(cite);
  };

  for (const change of changes) {
    if (change.workspacePath === test.workspacePath && change.status !== "D") {
      score = Math.max(score, 90);
      reasons.push("The test file itself changed.");
      remember(change.workspacePath, change.line);
    }
    for (const rule of explicit) {
      if (broadKeys.has(ruleKey(rule))) continue;
      if (!matchesChange(rule.match, change)) continue;
      if (!rule.tests.some((glob) => matchesTest(glob, test))) continue;
      score = Math.max(score, 100);
      reasons.push(`Explicit map ${rule.match} selects this test.`);
      remember(change.workspacePath, change.line);
    }
    const endpoint = overlap(change.signals.endpoints, test.signals.endpoints);
    if (endpoint) {
      score = Math.max(score, 80);
      reasons.push(`Exact endpoint match on ${endpoint}.`);
      remember(change.workspacePath, change.line);
    }
    const selector = overlap(change.signals.selectors, test.signals.selectors);
    if (selector) {
      score = Math.max(score, 80);
      reasons.push(`Exact selector match on ${selector}.`);
      remember(change.workspacePath, change.line);
    }
    const symbol = overlap(change.signals.symbols, [...test.signals.symbols, ...words(test.name)]);
    if (symbol && symbol.length >= 4) {
      score = Math.max(score, 50);
      reasons.push(`Symbol ${symbol} appears in the change and the test.`);
      remember(change.workspacePath, change.line);
    }
    if (sharedToken(change.idPath, test.idPath)) {
      score = Math.max(score, 25);
      reasons.push("The change and the test share a module name.");
      remember(change.workspacePath, change.line);
    }
  }

  if (score < 15) return null;
  let tier = tierFor(score);
  if (test.skipped) {
    score -= 30;
    tier = dropTier(tier);
    reasons.push("The test is skipped, flaky, or disabled.");
  }
  if (score < 15) return null;
  remember(test.workspacePath, test.line);
  return { test, score, tier, reasons: unique(reasons), evidence: evidence.slice(0, 6) };
}

function selectorRisks(changes: ScoreChange[], tests: ScoreTest[]): ImpactRisk[] {
  const risks: ImpactRisk[] = [];
  for (const change of changes) {
    if (change.role === "automation") continue;
    for (const removed of change.signals.removedSelectors) {
      if (change.signals.addedSelectors.includes(removed)) continue;
      const test = tests.find((item) => item.signals.selectors.includes(removed));
      if (!test) continue;
      risks.push({
        severity: "high",
        category: "selector-drift",
        source: change.line > 0 ? `${change.workspacePath}:${change.line}` : change.workspacePath,
        automation: test.line > 0 ? `${test.workspacePath}:${test.line}` : test.workspacePath,
        action: `Update the locator that still uses ${removed}.`,
      });
      if (risks.length >= 20) return risks;
    }
  }
  return risks;
}

function matchesChange(glob: string, change: ScoreChange): boolean {
  return matchesPaths(glob, change);
}

function matchesPaths(glob: string, change: PolicyChange): boolean {
  return matchGlob(glob, change.idPath) || matchGlob(glob, change.workspacePath);
}

function matchesTest(glob: string, test: ScoreTest): boolean {
  return matchGlob(glob, test.idPath) || matchGlob(glob, test.workspacePath);
}

function evidenceMatchesPath(evidence: string, path: string): boolean {
  return evidence === path || evidence.startsWith(`${path}:`);
}

function tierFor(score: number): TestTier {
  if (score >= 80) return "must";
  if (score >= 40) return "should";
  return "optional";
}

function dropTier(tier: TestTier): TestTier {
  if (tier === "must") return "should";
  if (tier === "should") return "optional";
  return "optional";
}

function overlap(left: string[], right: string[]): string | null {
  const wanted = new Set(right.map(normalizeSignal));
  for (const item of left) {
    if (wanted.has(normalizeSignal(item))) return item;
  }
  return null;
}

function normalizeSignal(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function sharedToken(left: string, right: string): boolean {
  const tokens = new Set(pathTokens(left));
  return pathTokens(right).some((token) => tokens.has(token));
}

function pathTokens(file: string): string[] {
  return file
    .split(/[/._-]+/)
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 5 && !STOP_TOKENS.has(token));
}

function words(value: string): string[] {
  return value.split(/[^A-Za-z0-9_]+/).filter((word) => word.length >= 4);
}

function toSelected(hit: Hit): SelectedTest {
  return {
    id: hit.test.id || hit.test.name,
    name: hit.test.name,
    file: hit.test.workspacePath,
    suite: hit.test.suite,
    reason: hit.reasons.join(" "),
    evidence: hit.evidence,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function globToRegExp(glob: string): RegExp {
  let source = "";
  let index = 0;
  while (index < glob.length) {
    if (glob.startsWith("**/", index)) {
      source += "(?:.*/)?";
      index += 3;
      continue;
    }
    if (glob.startsWith("**", index)) {
      source += ".*";
      index += 2;
      continue;
    }
    const char = glob[index];
    index += 1;
    if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${source}$`);
}
