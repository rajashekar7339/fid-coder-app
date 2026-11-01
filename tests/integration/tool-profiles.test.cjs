// Tests which tools each agent profile exposes.
const assert = require("node:assert/strict");
const test = require("node:test");
const { toolsForAgent } = require("../../dist/tools/registry.js");

test("developer tools include patch, git, and explore, and the browser profile does not", () => {
  const browser = toolsForAgent("browser").map((tool) => tool.name);
  const developer = toolsForAgent("developer").map((tool) => tool.name);
  for (const name of ["read_many", "apply_patch", "git_status", "git_diff", "git_log", "gh_pr_view", "gh_pr_diff", "explore_code"]) {
    assert.equal(developer.includes(name), true, name);
    assert.equal(browser.includes(name), false, name);
  }
});

test("analyst tools analyze a release and do not include shell or browser", () => {
  const analyst = toolsForAgent("analyst").map((tool) => tool.name);
  for (const name of ["impact_analyze", "file_read", "file_write", "git_diff", "search_text"]) {
    assert.equal(analyst.includes(name), true, name);
  }
  assert.equal(analyst.includes("shell_run"), false);
  assert.equal(analyst.includes("browser_navigate"), false);
  assert.equal(analyst.includes("explore_code"), false);
});
