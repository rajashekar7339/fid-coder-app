import fs from "fs";
import path from "path";
import { analyzeRelease, doctorImpact, explainImpact } from "../main/release-impact/index";
import { templateConfig, templatePreset, templatePrompt } from "../main/release-impact/preset";

const HELP = `release-impact init [--template playwright|generic]
release-impact doctor [--config <path>]
release-impact analyze [--config <path>] [--prod <ref>] [--candidate <ref>] [--output <dir>] [--dry-run]
release-impact explain <test-id> [--config <path>]

Paths are relative to the current workspace. Exit 0 writes a report, 2 is an invalid config, and 3 recommends full regression.`;

function flag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

async function main(): Promise<number> {
  const command = process.argv[2];
  const workspace = process.cwd();
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return 0;
  }
  if (command === "init") return init(workspace);
  if (command === "doctor") {
    const result = await doctorImpact(workspace, flag("--config"));
    console.log(result.text);
    return result.exitCode;
  }
  if (command === "analyze") return analyze(workspace);
  if (command === "explain") return explain(workspace);
  console.error(`error: unknown command ${command}`);
  return 2;
}

async function analyze(workspace: string): Promise<number> {
  const result = await analyzeRelease({
    workspaceDir: workspace,
    configPath: flag("--config"),
    prod: flag("--prod"),
    candidate: flag("--candidate"),
    outputDir: flag("--output"),
    dryRun: process.argv.includes("--dry-run"),
  });
  if (!result.summary.ok) {
    for (const error of result.summary.errors) console.error(`error: ${error}`);
    return result.exitCode;
  }
  const summary = result.summary;
  console.log(`Full regression: ${summary.fullRegression ? "yes" : "no"}`);
  console.log(`Changed files: ${summary.changedFiles}`);
  console.log(`Must run: ${summary.mustRunTotal}`);
  console.log(`Should run: ${summary.shouldRunTotal}`);
  if (summary.selectionText) console.log(`Selection: ${summary.selectionText}`);
  for (const reason of summary.fullRegressionReasons) console.log(`- ${reason}`);
  if (process.argv.includes("--dry-run")) console.log("Dry run. No files written.");
  else {
    console.log(`Wrote ${summary.report}`);
    console.log(`Wrote ${summary.selection}`);
  }
  return result.exitCode;
}

function explain(workspace: string): number {
  const id = process.argv[3];
  if (!id || id.startsWith("--")) {
    console.error("error: explain needs a test id");
    return 2;
  }
  const result = explainImpact(workspace, id, flag("--config"));
  if (result.exitCode === 0) console.log(result.text);
  else console.error(`error: ${result.text}`);
  return result.exitCode;
}

function init(workspace: string): number {
  const template = flag("--template") ?? "playwright";
  if (template !== "playwright" && template !== "generic") {
    console.error("error: template must be playwright or generic");
    return 2;
  }
  const configFile = path.join(workspace, ".release-impact", "config.json");
  if (fs.existsSync(configFile)) {
    console.error("error: .release-impact/config.json already exists");
    return 2;
  }
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.mkdirSync(path.join(workspace, "artifacts"), { recursive: true });
  fs.writeFileSync(configFile, templateConfig(template));
  fs.writeFileSync(path.join(workspace, ".release-impact", "prompt.md"), templatePrompt());
  fs.writeFileSync(path.join(workspace, ".release-impact", "agent-preset.json"), templatePreset());
  fs.writeFileSync(path.join(workspace, "artifacts", ".gitkeep"), "");
  console.log("Wrote .release-impact/config.json, prompt.md, agent-preset.json, and artifacts/");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
