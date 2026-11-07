// Checks that Ask mode registers only read-only tools and changes the system hint.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const secrets = require("../../dist/main/secrets.js");
secrets.hasSecret = () => false;
secrets.getSecret = () => null;

const copilot = require("../../dist/main/copilot/index.js");
copilot.getCopilotStatus = async () => ({ signedIn: true, authStatus: "Signed in" });
const opened = [];
copilot.openSession = async (input) => {
  opened.push(input);
  return {
    session: {
      sendAndWait: async () => ({ data: { content: "answer" } }),
      on: () => () => {},
      disconnect: async () => undefined,
    },
    unsubscribe: () => {},
  };
};

const { Runner } = require("../../dist/main/chat/runner.js");
const { AppDatabase } = require("../../dist/main/db/index.js");

test("Ask mode is read-only and keeps the workspace readable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-ask-mode-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "index.ts"), "export const value = 1;\n");
  const db = new AppDatabase(path.join(root, "app.sqlite"));
  try {
    const agent = db.createAgent({
      name: "Ask",
      systemPrompt: "Answer questions.",
      workspaceDir: workspace,
      model: "auto",
      toolProfile: "developer",
      readOnly: true,
      memoryEnabled: false,
    });

    const runner = new Runner(db, {}, { finalizeTurn: () => undefined });
    const view = await runner.previewContext(agent.id);
    assert.equal(view.readOnly, true);
    for (const name of ["list_dir", "glob_files", "search_text", "file_read", "read_many", "git_status", "git_diff", "git_log", "explore_code"]) {
      assert.equal(view.tools.includes(name), true, name);
    }
    for (const name of ["file_write", "apply_patch", "shell_run", "browser_navigate", "jira_search"]) {
      assert.equal(view.tools.includes(name), false, name);
    }
    assert.match(view.systemMessage, /You are in Ask mode/);
    assert.match(view.systemMessage, /Do not edit files/);
    assert.doesNotMatch(view.systemMessage, /Edit an existing file with apply_patch/);

    assert.equal(await runner.runTurn({ agentId: agent.id, text: "How does it start?", source: "chat" }), "answer");
    assert.equal(opened.length, 1);
    assert.equal(opened[0].tools.some((tool) => tool.name === "shell_run"), false);
    assert.equal(opened[0].tools.some((tool) => tool.name === "apply_patch"), false);
    assert.match(opened[0].systemMessage, /You are in Ask mode/);
    assert.equal(typeof opened[0].getContext().explore, "function");

    db.updateAgent(agent.id, {
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      workspaceDir: workspace,
      model: "auto",
      toolProfile: "developer",
      readOnly: false,
      memoryEnabled: false,
    });
    const code = await runner.previewContext(agent.id);
    assert.equal(code.readOnly, false);
    for (const name of ["file_write", "apply_patch", "shell_run"]) {
      assert.equal(code.tools.includes(name), true, name);
    }
    assert.match(code.systemMessage, /Edit an existing file with apply_patch/);
    assert.doesNotMatch(code.systemMessage, /You are in Ask mode/);

    const bare = db.createAgent({
      name: "Ask without a workspace",
      systemPrompt: "Answer questions.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
      readOnly: true,
      memoryEnabled: false,
    });
    const bareView = await runner.previewContext(bare.id);
    assert.equal(bareView.readOnly, true);
    assert.equal(bareView.tools.includes("file_write"), false);
    assert.equal(bareView.tools.includes("shell_run"), false);
    assert.match(bareView.systemMessage, /Add a workspace folder/);

    const browserAgent = db.createAgent({
      name: "Browser ask",
      systemPrompt: "Read pages.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "browser",
      readOnly: true,
      memoryEnabled: false,
    });
    const browserView = await runner.previewContext(browserAgent.id);
    assert.equal(browserView.readOnly, true);
    for (const name of ["browser_navigate", "browser_snapshot", "history_first"]) {
      assert.equal(browserView.tools.includes(name), true, name);
    }
    for (const name of ["browser_click", "browser_type", "file_write", "shell_run"]) {
      assert.equal(browserView.tools.includes(name), false, name);
    }
    assert.match(browserView.systemMessage, /Only read-only tools are available/);
    assert.match(browserView.systemMessage, /Do not edit files, run shell commands, click, type, submit a form/);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
