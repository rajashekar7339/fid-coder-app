// Checks that a chat send cannot start while an enhance call is running.
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
copilot.listCopilotModels = async () => [{ id: "gpt-4.1-mini", name: "GPT-4.1 mini" }];
let release = null;

const { Runner } = require("../../dist/main/chat/runner.js");
const { AppDatabase } = require("../../dist/main/db/index.js");

test("a short draft is still sent to the model", async () => {
  copilot.completeOnce = async () => "Fix the login bug.";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-enhance-short-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const agent = db.createAgent({
      name: "Short enhance",
      systemPrompt: "Reply briefly.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
      memoryEnabled: false,
    });
    const runner = new Runner(db, {}, { finalizeTurn: () => undefined });
    assert.deepEqual(await runner.enhanceDraft(agent.id, "fix it"), {
      status: "enhanced",
      text: "Fix the login bug.",
    });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a send waits while an enhance is running", async () => {
  release = null;
  copilot.completeOnce = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-enhance-guard-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const agent = db.createAgent({
      name: "Enhance guard",
      systemPrompt: "Reply briefly.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
      memoryEnabled: false,
    });
    const runner = new Runner(db, {}, { finalizeTurn: () => undefined });
    const draft =
      "The login flow breaks when the cookie expires and the redirect keeps looping. Inspect the whole flow and tell me what to fix.";
    const pending = runner.enhanceDraft(agent.id, draft);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
    await assert.rejects(
      runner.runTurn({ agentId: agent.id, text: "hello", source: "chat" }),
      /Wait until the enhancement finishes/,
    );
    assert.equal(db.listMessages(agent.id).length, 0);

    release("Fix the login redirect loop when the session cookie expires.");
    const result = await pending;
    assert.equal(result.status, "enhanced");
    assert.match(result.text, /login redirect loop/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
