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
