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

test("a sensitive command waits for the host decision", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-shell-"));
  try {
    let request = null;
    const denyContext = {
      ...context(root),
      requestApproval: async (next) => {
        request = next;
        return { approved: false, decision: "deny", source: "user", reason: "Not now." };
      },
    };
    await assert.rejects(
      shellRun.handler({ command: "del notes.txt" }, denyContext),
      /Command not approved: Not now/,
    );
    assert.equal(request.kind, "shell");
    assert.equal(request.command, "del notes.txt");
    assert.match(request.reason, /delete/i);

    const approveContext = {
      ...context(root),
      requestApproval: async () => ({
        approved: true,
        decision: "allow",
        source: "user",
        reason: "Approved once.",
      }),
    };
    const target = path.join(root, "delete-me.txt");
    fs.writeFileSync(target, "delete me");
    await shellRun.handler({ command: "del delete-me.txt" }, approveContext);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
