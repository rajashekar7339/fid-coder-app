const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { AppDatabase } = require("../dist/main/db.js");
const { AUTO_MODEL_ID, catalogModels, isListedModelId, modelLabel, normalizeModelId } = require("../dist/shared/model.js");

test("Auto is the default model id", () => {
  assert.equal(normalizeModelId(undefined), AUTO_MODEL_ID);
  assert.equal(normalizeModelId(""), AUTO_MODEL_ID);
  assert.equal(normalizeModelId(" AUTO "), AUTO_MODEL_ID);
  assert.equal(normalizeModelId("claude-sonnet-4.5"), "claude-sonnet-4.5");
  assert.equal(isListedModelId("auto"), false);
  assert.equal(isListedModelId("gpt-5.4"), true);
  assert.throws(() => normalizeModelId("not a model"), /available model/);
  assert.equal(modelLabel("auto", []), "Auto");
  assert.equal(modelLabel("gpt-5", [{ id: "gpt-5", name: "GPT-5" }]), "GPT-5");
  assert.equal(modelLabel("missing", []), "missing");
});

test("model menu uses the session list, or price categories when that list is empty", () => {
  const priced = catalogModels({
    clientModels: [{ id: "auto", name: "Auto" }],
    sessionModels: [],
    priceCategories: [
      { id: "gpt-4o", priceCategory: "medium" },
      { id: "gpt-5.6-luna-free-auto", priceCategory: "low" },
      { id: "claude-haiku-4.5", priceCategory: "low" },
    ],
  });
  assert.deepEqual(
    priced.map((model) => model.id),
    ["gpt-4o", "claude-haiku-4.5"],
  );
  assert.equal(priced[0].name, "gpt-4o · Medium cost");

  const named = catalogModels({
    sessionModels: [
      { id: "gpt-5.4", name: "GPT-5.4" },
      { id: "old", name: "Old", policy: { state: "disabled" } },
    ],
    priceCategories: [{ id: "gpt-4o", priceCategory: "medium" }],
  });
  assert.deepEqual(
    named.map((model) => model.id),
    ["gpt-5.4"],
  );
});

test("existing agents default to Auto and keep a chosen model", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-model-"));
  const file = path.join(dir, "app.sqlite");
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      workspace_dir TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  raw
    .prepare(
      "INSERT INTO agents (id, name, system_prompt, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)",
    )
    .run("11111111-1111-4111-8111-111111111111", "Old", "Prompt", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  raw.close();

  const db = new AppDatabase(file);
  try {
    assert.equal(db.getAgent("11111111-1111-4111-8111-111111111111").model, AUTO_MODEL_ID);
    const created = db.createAgent({
      name: "Picker",
      systemPrompt: "Reply briefly.",
      workspaceDir: null,
      model: "gpt-5",
    });
    assert.equal(created.model, "gpt-5");
    const updated = db.updateAgent(created.id, {
      name: created.name,
      systemPrompt: created.systemPrompt,
      workspaceDir: created.workspaceDir,
      model: "auto",
    });
    assert.equal(updated.model, AUTO_MODEL_ID);
    assert.throws(
      () =>
        db.createAgent({
          name: "Bad",
          systemPrompt: "Reply briefly.",
          workspaceDir: null,
          model: "drop table",
        }),
      /available model/,
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("new databases seed agents on Auto", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-model-seed-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const agents = db.listAgents();
    assert.ok(agents.length >= 2);
    assert.ok(agents.every((agent) => agent.model === AUTO_MODEL_ID));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
