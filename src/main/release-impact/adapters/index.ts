import { matchGlob, type ScoreTest } from "../../../shared/release-impact/score";
import { isDeprecatedPath } from "../../../shared/release-impact/paths";
import type { ResolvedRepo } from "../collect";
import { gitOutput } from "../git";
import { parseGeneric } from "./generic";
import { parsePlaywright } from "./playwright";

export const DEFAULT_MAX_TEST_FILES = 500;
const inventoryCache = new Map<string, ScoreTest[]>();

const DEFAULT_GLOBS: Record<string, string[]> = {
  playwright: ["**/*.{spec,test}.{js,ts,jsx,tsx}"],
  cypress: ["**/*.{cy,spec}.{js,ts,jsx,tsx}"],
  jest: ["**/*.{test,spec}.{js,ts,jsx,tsx}"],
  vitest: ["**/*.{test,spec}.{js,ts,jsx,tsx}"],
  testng: ["**/*Test.java", "**/*.xml"],
  junit: ["**/*Test.java"],
  cucumber: ["**/*.feature"],
  robot: ["**/*.robot"],
  generic: ["**/*.{test,spec}.{js,ts,jsx,tsx,java}", "**/*.feature", "**/*.robot"],
};

export type IndexResult = {
  tests: ScoreTest[];
  unknowns: string[];
  failed: boolean;
  counts: Record<string, number>;
};

export async function indexAutomation(
  repos: ResolvedRepo[],
  fileLimit: number = DEFAULT_MAX_TEST_FILES,
  ignoreGlobs: string[] = [],
): Promise<IndexResult> {
  const tests: ScoreTest[] = [];
  const unknowns: string[] = [];
  const counts: Record<string, number> = {};
  let failed = false;
  const automation = repos.filter((repo) => repo.role === "automation");
  if (automation.length === 0) {
    return { tests, unknowns: ["No automation repo is configured."], failed: true, counts };
  }
  for (const repo of automation) {
    counts[repo.id] = 0;
    if (repo.error || !repo.candidateSha) {
      failed = true;
      unknowns.push(repo.error ?? `${repo.id} has no candidate ref to index.`);
      continue;
    }
    const framework = (repo.framework || "generic").toLowerCase();
    const globs = repo.testGlobs?.length ? repo.testGlobs : DEFAULT_GLOBS[framework] ?? DEFAULT_GLOBS.generic;
    const cacheKey = `${repo.id}:${repo.absolute}:${repo.candidateSha}:${framework}:${fileLimit}:${globs.join("|")}:${repo.caseIdPattern ?? ""}:${ignoreGlobs.join("|")}`;
    const cached = inventoryCache.get(cacheKey);
    if (cached) {
      counts[repo.id] = cached.length;
      tests.push(...cached);
      continue;
    }
    const listed = await gitOutput(repo.absolute, ["ls-tree", "-r", "--name-only", repo.candidateSha]);
    if (!listed.ok) {
      failed = true;
      unknowns.push(`${repo.id} test index failed: ${listed.error || "git ls-tree failed"}`);
      continue;
    }
    const files = listed.text
      .split("\n")
      .map((line) => line.trim().replace(/\\/g, "/"))
      .filter(
        (file) =>
          file &&
          !isDeprecatedPath(file) &&
          !ignoreGlobs.some((glob) => matchGlob(glob, file)) &&
          globs.some((glob) => matchGlob(glob, file)),
      );
    if (files.length === 0) {
      failed = true;
      unknowns.push(`${repo.id} adapter found no test files.`);
      continue;
    }
    const indexed: ScoreTest[] = [];
    for (const file of files.slice(0, fileLimit)) {
      const shown = await gitOutput(repo.absolute, ["show", `${repo.candidateSha}:${file}`]);
      if (!shown.ok) continue;
      if (shown.text.includes("…truncated")) unknowns.push(`${repo.id} ${file} was truncated while indexing.`);
      const parsed = framework === "playwright"
        ? parsePlaywright(shown.text, repo.caseIdPattern)
        : parseGeneric(shown.text, repo.caseIdPattern);
      const workspacePath = repo.relative === "." ? file : `${repo.relative}/${file}`;
      for (const test of parsed) {
        indexed.push({
          id: test.id,
          name: test.name,
          idPath: `${repo.id}/${file}`,
          workspacePath,
          suite: test.suite || file.split("/").slice(0, -1).join("/") || repo.id,
          line: test.line,
          skipped: test.skipped,
          signals: test.signals,
        });
      }
    }
    if (files.length > fileLimit) {
      unknowns.push(
        `${repo.id} indexed the first ${fileLimit} of ${files.length} test files. Raise policy.maxTestFiles to index more.`,
      );
    }
    if (indexed.length === 0) {
      failed = true;
      unknowns.push(`${repo.id} adapter could not read any tests.`);
      continue;
    }
    counts[repo.id] = indexed.length;
    inventoryCache.set(cacheKey, indexed);
    tests.push(...indexed);
    if (framework !== "playwright" && framework !== "generic" && !DEFAULT_GLOBS[framework]) {
      unknowns.push(`${repo.id} framework ${framework} uses the generic adapter.`);
    }
  }
  return { tests, unknowns, failed, counts };
}
