import type { AgentToolProfile } from "../shared/types";
import { browserTools } from "./browser/browser";
import { exploreCodeTool } from "./explore/explore-code";
import { exploreTools } from "./explore/explore";
import { fileTools } from "./files/files";
import { gitTools } from "./git/git";
import { historyTools } from "./history/history";
import { jiraTools } from "./jira/jira";
import { impactTools } from "./release/impact";
import { reviewCodeTool } from "./review/review";
import { shellTools } from "./shell/shell";
import type { AppTool } from "./types";

const readNames = new Set(["file_read", "read_many"]);
const reviewReadNames = new Set(["git_status", "git_diff", "git_log", "gh_pr_view", "gh_pr_diff"]);
const askReadNames = new Set([
  "list_dir",
  "glob_files",
  "search_text",
  "file_read",
  "read_many",
  "git_status",
  "git_diff",
  "git_log",
  "gh_pr_view",
  "gh_pr_diff",
  "browser_navigate",
  "browser_snapshot",
  "jira_myself",
  "jira_search",
  "jira_issue",
  "history_first",
  "history_search",
  "history_turn",
  "history_context",
  "explore_code",
]);

export function readOnlyTools(): AppTool[] {
  return [...exploreTools, ...fileTools.filter((tool) => readNames.has(tool.name))];
}

export function reviewTools(): AppTool[] {
  return [...readOnlyTools(), ...gitTools.filter((tool) => reviewReadNames.has(tool.name))];
}

/** Ask mode: keep the agent's normal profile, but expose only tools that cannot change state. */
export function askTools(profile: AgentToolProfile): AppTool[] {
  return toolsForAgent(profile).filter((tool) => askReadNames.has(tool.name));
}

export function allTools(): AppTool[] {
  return [
    ...browserTools,
    ...jiraTools,
    ...shellTools,
    ...exploreTools,
    ...fileTools,
    ...gitTools,
    ...historyTools,
    exploreCodeTool,
    reviewCodeTool,
  ];
}

export function toolsForAgent(profile: AgentToolProfile): AppTool[] {
  if (profile === "browser") return [...browserTools, ...jiraTools, ...historyTools];
  if (profile === "analyst") {
    return [
      ...exploreTools,
      ...fileTools,
      ...gitTools,
      ...impactTools,
    ];
  }
  if (profile === "developer") {
    return [
      ...shellTools,
      ...exploreTools,
      ...fileTools,
      ...gitTools,
      ...historyTools,
      exploreCodeTool,
      reviewCodeTool,
    ];
  }
  return allTools();
}
