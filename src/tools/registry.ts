import type { AgentToolProfile } from "../shared/types";
import { askUserTool } from "./ask/ask";
import { browserTools } from "./browser/browser";
import { exploreCodeTool } from "./explore/explore-code";
import { exploreTools } from "./explore/explore";
import { fileTools } from "./files/files";
import { gitTools } from "./git/git";
import { historyTools } from "./history/history";
import { jiraTools } from "./jira/jira";
import { reviewCodeTool } from "./review/review";
import { routineTools } from "./routines/routines";
import { shellTools } from "./shell/shell";
import type { AppTool } from "./types";

const readNames = new Set(["file_read", "read_many"]);
const reviewReadNames = new Set(["git_status", "git_diff", "git_log", "gh_pr_view", "gh_pr_diff"]);
const routineManagementTools = routineTools.filter((tool) => tool.name !== "routine_create");
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
  "ask_user",
]);

export function readOnlyTools(): AppTool[] {
  return [...exploreTools, ...fileTools.filter((tool) => readNames.has(tool.name))];
}

export function reviewTools(): AppTool[] {
  return [...readOnlyTools(), ...gitTools.filter((tool) => reviewReadNames.has(tool.name))];
}

/** Ask mode: every read-only tool, regardless of the Agent-mode profile. */
export function askTools(): AppTool[] {
  return toolsForAgent("all").filter((tool) => askReadNames.has(tool.name));
}

/** The /routine turn exposes only the tool that creates the routine. */
export function routineCreateTools(): AppTool[] {
  return routineTools.filter((tool) => tool.name === "routine_create");
}

export function allTools(): AppTool[] {
  return [
    askUserTool,
    ...browserTools,
    ...jiraTools,
    ...shellTools,
    ...exploreTools,
    ...fileTools,
    ...gitTools,
    ...historyTools,
    ...routineManagementTools,
    exploreCodeTool,
    reviewCodeTool,
  ];
}

export function toolsForAgent(profile: AgentToolProfile): AppTool[] {
  if (profile === "browser") {
    return [askUserTool, ...browserTools, ...jiraTools, ...historyTools, ...routineManagementTools];
  }
  if (profile === "developer") {
    return [
      askUserTool,
      ...shellTools,
      ...exploreTools,
      ...fileTools,
      ...gitTools,
      ...historyTools,
      ...routineManagementTools,
      exploreCodeTool,
      reviewCodeTool,
    ];
  }
  return allTools();
}
