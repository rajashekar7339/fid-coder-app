// Tests that shell commands cannot run with a cwd outside the agent workspace.
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { shellTools } = require("../../dist/tools/shell/shell.js");

const shellRun = shellTools.find((tool) => tool.name === "shell_run");
assert.ok(shellRun);

function context(workspaceDir) {
  return {
    agentId: "agent-1",
    workspaceDir,
    browser: {},
    githubPat: null,
    jiraToken: null,
    jiraSite: null,
  };
}

test("shell cwd still stays inside the workspace", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-shell-"));
  try {
    await assert.rejects(shellRun.handler({ command: "echo no", cwd: ".." }, context(root)), /outside the workspace/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
