import { IMPACT_OUTPUT_ROOT } from "../../shared/release-impact/paths";

export const ANALYST_NAME = "Release Impact Analyst";
export const ANALYST_DESCRIPTION = "Compares prod and a candidate release and selects the tests to run.";

export const ANALYST_PROMPT = `You are a release impact analyst. Work only inside the workspace folder. Read the release-impact config and run impact_analyze. Use only the engine output and the files it names. Cite path:line for every claim. Never invent test IDs. Mark missing evidence as Needs review. If a full-regression trigger matches, put it first. Write the final report to the report path from impact_analyze, under ${IMPACT_OUTPUT_ROOT}/. Do not change selected-tests.json. Never edit source or automation repos. If no workspace folder is set, ask the user to pick one.`;

export function templateConfig(framework: "playwright" | "generic"): string {
  const automation =
    framework === "playwright"
      ? {
          framework: "playwright",
          testGlobs: ["tests/**/*.spec.ts"],
          caseIdPattern: "TC-\\d+",
        }
      : {
          framework: "generic",
          testGlobs: ["**/*.{test,spec}.{js,ts}", "**/*Test.java", "**/*.feature", "**/*.robot"],
          caseIdPattern: "TC-\\d+",
        };
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      team: "example-team",
      repos: [
        {
          id: "service",
          path: "repos/service",
          role: "source",
          language: "typescript",
          prod: "origin/main",
          candidate: "HEAD",
        },
        {
          id: "automation",
          path: "repos/automation",
          role: "automation",
          ...automation,
          prod: "origin/main",
          candidate: "HEAD",
        },
      ],
      ignore: ["**/node_modules/**", "**/dist/**", "**/target/**", "**/build/**", "**/*.lock"],
      mapping: {
        explicit: [{ match: "service/src/**", tests: ["automation/tests/**"] }],
      },
      policy: {
        fullRegression: ["**/auth/**", "**/migrations/**", "**/openapi*.yaml"],
        minMappingCoverage: 0.7,
        maxChangedFiles: 400,
        allowCustomAdapters: false,
      },
      outputs: {
        report: `${IMPACT_OUTPUT_ROOT}/impact-report.md`,
        selection: `${IMPACT_OUTPUT_ROOT}/selected-tests.json`,
        selectionFormat: framework === "playwright" ? "playwright-grep" : "file-list",
      },
    },
    null,
    2,
  )}\n`;
}

export function templatePrompt(): string {
  return `${ANALYST_PROMPT}\n`;
}

export function templatePreset(): string {
  return `${JSON.stringify(
    {
      name: ANALYST_NAME,
      description: "Compares prod and candidate refs and selects the regression tests to run.",
      toolProfile: "analyst",
      configFile: ".release-impact/config.json",
      systemPromptFile: ".release-impact/prompt.md",
      readOnlyRepos: true,
    },
    null,
    2,
  )}\n`;
}
