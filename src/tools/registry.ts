import type { AgentToolProfile } from "../shared/types";
import { browserTools } from "./browser/browser";
import { exploreCodeTool } from "./explore/explore-code";
import { exploreTools } from "./explore/explore";
import { fileTools } from "./files/files";
import { gitTools } from "./git/git";
import { jiraTools } from "./jira/jira";
import { planTools } from "./plan";
import { shellTools } from "./shell/shell";
import type { AppTool } from "./types";

const readNames = new Set(["file_read", "read_many"]);

export function readOnlyTools(): AppTool[] {
  return [...exploreTools, ...fileTools.filter((tool) => readNames.has(tool.name))];
}

export function allTools(): AppTool[] {
  return [
    ...browserTools,
    ...jiraTools,
    ...shellTools,
    ...exploreTools,
    ...fileTools,
    ...gitTools,
    exploreCodeTool,
    ...planTools,
  ];
}

export function toolsForAgent(profile: AgentToolProfile): AppTool[] {
  if (profile === "browser") return [...browserTools, ...jiraTools, ...planTools];
  if (profile === "developer") {
    return [...shellTools, ...exploreTools, ...fileTools, ...gitTools, exploreCodeTool, ...planTools];
  }
  return allTools();
}
