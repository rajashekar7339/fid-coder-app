import { REPORT_ONLY_EXCLUDED } from "../shared/routine-schedule";
import type { AgentToolProfile } from "../shared/types";
import { askUserTool } from "./ask/ask";
import { browserTools } from "./browser/browser";
import { confluenceTools } from "./confluence/confluence";
import { exploreCodeTool } from "./explore/explore-code";
import { exploreTools } from "./explore/explore";
import { fileTools } from "./files/files";
import { gitTools } from "./git/git";
import { historyTools } from "./history/history";
import { jiraTools } from "./jira/jira";
import { reviewCodeTool } from "./review/review";
import { routineTools } from "./routines/routines";
import { saveSkillTool } from "./skills/save";
import { shellTools } from "./shell/shell";
import { tableTools } from "./table/table";
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
  "confluence_search",
  "confluence_page",
  "table_read",
  "history_first",
  "history_search",
  "history_turn",
  "history_context",
  "explore_code",
  "ask_user",
  "browser_needs_you",
  "save_skill",
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

/** A report-only routine: Ask tools, without questions, browser handoff, or saving a skill. */
export function reportOnlyTools(): AppTool[] {
  return askTools().filter((tool) => !REPORT_ONLY_EXCLUDED.has(tool.name));
}

/** The /routine turn exposes only the tool that creates the routine. */
export function routineCreateTools(): AppTool[] {
  return routineTools.filter((tool) => tool.name === "routine_create");
}

export function allTools(): AppTool[] {
  return [
    askUserTool,
    saveSkillTool,
    ...browserTools,
    ...jiraTools,
    ...confluenceTools,
    ...tableTools,
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
    return [
      askUserTool,
      saveSkillTool,
      ...browserTools,
      ...jiraTools,
      ...confluenceTools,
      ...tableTools,
      ...historyTools,
      ...routineManagementTools,
    ];
  }
  if (profile === "developer") {
    return [
      askUserTool,
      saveSkillTool,
      ...shellTools,
      ...exploreTools,
      ...fileTools,
      ...tableTools,
      ...confluenceTools,
      ...gitTools,
      ...historyTools,
      ...routineManagementTools,
      exploreCodeTool,
      reviewCodeTool,
    ];
  }
  return allTools();
}
