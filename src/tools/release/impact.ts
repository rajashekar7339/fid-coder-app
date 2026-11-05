import { asRecord, optionalBoolean, optionalString } from "../args";
import { analyzeRelease } from "../../main/release-impact/index";
import type { AppTool } from "../types";
import { workspaceRoot } from "../workspace";

export const impactTools: AppTool[] = [
  {
    name: "impact_analyze",
    description:
      "Compare prod and candidate refs from the workspace release-impact config. Returns the selected tests, risks, and full-regression reasons. Writes the report and selected-tests.json unless dryRun is true. Use this instead of shell_run for release analysis.",
    parameters: {
      type: "object",
      properties: {
        configPath: { type: "string", description: "Config path relative to the workspace. Omit to use the default discovery order." },
        prod: { type: "string", description: "Override the prod ref when the config has no release manifest." },
        candidate: { type: "string", description: "Override the candidate ref when the config has no release manifest." },
        dryRun: { type: "boolean", description: "Return the analysis without writing report files." },
      },
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const result = await analyzeRelease({
        workspaceDir: workspaceRoot(ctx.workspaceDir),
        configPath: optionalString(record, "configPath"),
        prod: optionalString(record, "prod"),
        candidate: optionalString(record, "candidate"),
        outputRoot: ctx.writeRoot ?? null,
        dryRun: optionalBoolean(record, "dryRun"),
      });
      return JSON.stringify(result.summary, null, 2);
    },
  },
];
