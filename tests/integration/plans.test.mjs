// Tests persistence of the current plan in SQLite.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import databaseModule from "../../dist/main/db/index.js";

const { AppDatabase } = databaseModule;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-plans-"));
  const db = new AppDatabase(path.join(root, "test.sqlite"));
  const agent = db.createAgent({
    name: "Test agent",
    description: "",
    systemPrompt: "Test",
    workspaceDir: null,
    model: "auto",
    toolProfile: "developer",
    memoryEnabled: false,
  });
  return {
    db,
    agent,
    cleanup() {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("stores and clears the current plan", () => {
  const { db, agent, cleanup } = setup();
  try {
    const turnId = db.createTurn(agent.id, "chat");
    const steps = [
      { text: "Read the code", status: "done" },
      { text: "Apply the fix", status: "in_progress" },
    ];
    db.setPlan(agent.id, turnId, steps);
    const plan = db.getPlan(agent.id);
    assert.ok(plan);
    assert.equal(plan.turnId, turnId);
    assert.deepEqual(plan.steps, steps);
    db.setPlan(agent.id, turnId, [{ text: "Only step", status: "pending" }]);
    assert.deepEqual(db.getPlan(agent.id).steps, [{ text: "Only step", status: "pending" }]);
    db.clearPlan(agent.id);
    assert.equal(db.getPlan(agent.id), null);
  } finally {
    cleanup();
  }
});
