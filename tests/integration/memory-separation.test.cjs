// Regression: agent Instructions are a standing system prompt, not memory.
// This proves the two inputs are stored and assembled separately.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// previewContext reads the settings/tools flags through the secret store.
// The test has no Electron app, so stub the read-only checks before loading
// the runner.
const secrets = require("../../dist/main/secrets.js");
secrets.hasSecret = () => false;
secrets.getSecret = () => null;

const { AppDatabase } = require("../../dist/main/db/index.js");
const { Runner } = require("../../dist/main/chat/runner.js");

test("agent instructions stay in the system message and memory stays separate", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-memory-separation-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const agent = db.createAgent({
      name: "Perf harness coder",
      systemPrompt: "Read project and give me full description of it",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
      memoryEnabled: true,
    });
    const summary = "Project is a PowerShell benchmark harness.";
    db.setMemorySummary(agent.id, summary, 12);

    const runner = new Runner(db, {}, {});
    const view = await runner.previewContext(agent.id);

    assert.match(view.systemMessage, /Read project and give me full description of it/);
    assert.doesNotMatch(view.systemMessage, /PowerShell benchmark harness/);
    assert.match(view.systemMessage, /fenced mermaid sequenceDiagram/);
    assert.equal(view.memorySummary, summary);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
