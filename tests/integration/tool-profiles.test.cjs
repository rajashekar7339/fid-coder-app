// Tests which tools each agent profile exposes.
const assert = require("node:assert/strict");
const test = require("node:test");
const { askTools, reviewTools, routineCreateTools, toolsForAgent } = require("../../dist/tools/registry.js");
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
  for (const name of ["file_write", "apply_patch", "shell_run", "browser_navigate", "browser_needs_you", "save_skill", "review_code"]) {
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

test("ask_user is on every chat profile and not on the review subagent", () => {
  for (const profile of ["browser", "developer", "all"]) {
    assert.equal(toolsForAgent(profile).some((tool) => tool.name === "ask_user"), true, profile);
  }
  assert.equal(askTools().some((tool) => tool.name === "ask_user"), true);
  assert.equal(reviewTools().some((tool) => tool.name === "ask_user"), false);
});

test("browser handoff and save skill follow the mode rules", () => {
  const ask = askTools().map((tool) => tool.name);
  const review = reviewTools().map((tool) => tool.name);
  const routine = routineCreateTools().map((tool) => tool.name);
  assert.equal(ask.includes("browser_needs_you"), true);
  assert.equal(ask.includes("save_skill"), true);
  assert.equal(toolsForAgent("browser").some((tool) => tool.name === "browser_needs_you"), true);
  assert.equal(toolsForAgent("all").some((tool) => tool.name === "browser_needs_you"), true);
  assert.equal(toolsForAgent("developer").some((tool) => tool.name === "browser_needs_you"), false);
  for (const profile of ["browser", "developer", "all"]) {
    assert.equal(toolsForAgent(profile).some((tool) => tool.name === "save_skill"), true, profile);
  }
  for (const names of [review, routine]) {
    assert.equal(names.includes("browser_needs_you"), false);
    assert.equal(names.includes("save_skill"), false);
  }
});

test("Ask mode exposes every read-only tool and no writes or actions", () => {
  const names = askTools().map((tool) => tool.name);
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
  ]) {
    assert.equal(names.includes(name), true, name);
  }
  for (const name of [
    "file_write",
    "apply_patch",
    "shell_run",
    "browser_click",
    "browser_type",
    "review_code",
  ]) {
    assert.equal(names.includes(name), false, name);
  }
});
