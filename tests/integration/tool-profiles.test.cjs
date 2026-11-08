// Tests which tools each agent profile exposes.
const assert = require("node:assert/strict");
const test = require("node:test");
const { askTools, reviewTools, toolsForAgent } = require("../../dist/tools/registry.js");
const { reviewCodeTool } = require("../../dist/tools/review/review.js");

test("developer tools include patch, git, and explore, and the browser profile does not", () => {
  const browser = toolsForAgent("browser").map((tool) => tool.name);
  const developer = toolsForAgent("developer").map((tool) => tool.name);
  for (const name of ["read_many", "apply_patch", "git_status", "git_diff", "git_log", "gh_pr_view", "gh_pr_diff", "explore_code", "review_code"]) {
    assert.equal(developer.includes(name), true, name);
    assert.equal(browser.includes(name), false, name);
  }
});

test("the review subagent cannot edit, run shell, or browse", () => {
  const names = reviewTools().map((tool) => tool.name);
  for (const name of ["git_status", "git_diff", "git_log", "gh_pr_view", "gh_pr_diff", "file_read", "read_many", "search_text"]) {
    assert.equal(names.includes(name), true, name);
  }
  for (const name of ["file_write", "apply_patch", "shell_run", "browser_navigate", "review_code"]) {
    assert.equal(names.includes(name), false, name);
  }
});

test("review_code forwards the target to the read-only reviewer", async () => {
  let received = "";
  const result = await reviewCodeTool.handler(
    { target: "staged" },
    {
      workspaceDir: "C:/repo",
      review: async (target) => {
        received = target;
        return "report";
      },
    },
  );
  assert.equal(received, "staged");
  assert.equal(result, "report");
});

test("Ask mode adds the read-only explorer and keeps writes and shell out", () => {
  const names = askTools("developer").map((tool) => tool.name);
  for (const name of [
    "file_read",
    "read_many",
    "search_text",
    "list_dir",
    "glob_files",
    "git_status",
    "git_diff",
    "git_log",
    "gh_pr_view",
    "gh_pr_diff",
    "explore_code",
    "history_first",
    "history_search",
    "history_turn",
    "history_context",
  ]) {
    assert.equal(names.includes(name), true, name);
  }
  for (const name of ["file_write", "apply_patch", "shell_run", "browser_navigate", "jira_search", "review_code"]) {
    assert.equal(names.includes(name), false, name);
  }
});

test("Browser & Jira Ask mode reads pages and tickets without clicking or typing", () => {
  const names = askTools("browser").map((tool) => tool.name);
  for (const name of [
    "browser_navigate",
    "browser_snapshot",
    "jira_myself",
    "jira_search",
    "jira_issue",
    "history_first",
  ]) {
    assert.equal(names.includes(name), true, name);
  }
  for (const name of [
    "browser_click",
    "browser_type",
    "file_read",
    "file_write",
    "shell_run",
    "explore_code",
  ]) {
    assert.equal(names.includes(name), false, name);
  }
});
