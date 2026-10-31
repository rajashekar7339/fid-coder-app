// Tests SQLite migrations, seeded agents, and agent activity queries.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { AppDatabase } = require("../../dist/main/db/index.js");
const { AUTO_MODEL_ID } = require("../../dist/shared/model.js");

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
    assert.equal(db.getAgent("11111111-1111-4111-8111-111111111111").toolProfile, "all");
    const created = db.createAgent({
      name: "Picker",
      systemPrompt: "Reply briefly.",
      workspaceDir: null,
      model: "gpt-5",
    });
    assert.equal(created.model, "gpt-5");
    assert.equal(created.toolProfile, "all");
    const updated = db.updateAgent(created.id, {
      name: created.name,
      systemPrompt: created.systemPrompt,
      workspaceDir: created.workspaceDir,
      model: "auto",
      toolProfile: "developer",
    });
    assert.equal(updated.model, AUTO_MODEL_ID);
    assert.equal(updated.toolProfile, "developer");
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

test("tool profiles migrate once and keep later changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-profile-"));
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
  const now = "2026-01-01T00:00:00.000Z";
  raw
    .prepare("INSERT INTO agents (id, name, system_prompt, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)")
    .run("11111111-1111-4111-8111-111111111111", "JIRA Agent", "Prompt", now, now);
  raw
    .prepare("INSERT INTO agents (id, name, system_prompt, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)")
    .run("22222222-2222-4222-8222-222222222222", "GIT PR Review", "Prompt", now, now);
  raw.close();

  let db = new AppDatabase(file);
  try {
    const jira = db.getAgent("11111111-1111-4111-8111-111111111111");
    assert.equal(jira.toolProfile, "browser");
    assert.equal(db.getAgent("22222222-2222-4222-8222-222222222222").toolProfile, "developer");
    db.updateAgent(jira.id, {
      name: jira.name,
      systemPrompt: jira.systemPrompt,
      workspaceDir: null,
      model: jira.model,
      toolProfile: "all",
    });
    assert.equal(db.getAgent(jira.id).toolProfile, "all");
  } finally {
    db.close();
  }

  db = new AppDatabase(file);
  try {
    assert.equal(db.getAgent("11111111-1111-4111-8111-111111111111").toolProfile, "all");
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
    assert.equal(agents.find((agent) => agent.name === "JIRA Agent")?.description, "Jira teammate");
    assert.equal(agents.find((agent) => agent.name === "JIRA Agent")?.toolProfile, "browser");
    assert.equal(agents.find((agent) => agent.name === "GIT PR Review")?.toolProfile, "developer");
    assert.ok(agents.every((agent) => agent.lastActivityAt === null));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("agents expose their latest activity and next routine", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-summary-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const jira = db.listAgents().find((agent) => agent.name === "JIRA Agent");
    assert.ok(jira);
    const added = db.addMessage(jira.id, "user", "Hello");
    const active = db.getAgent(jira.id);
    assert.equal(active?.lastActivityAt, added.createdAt);

    const next = new Date(Date.now() + 60_000).toISOString();
    db.createRoutine(
      {
        agentId: jira.id,
        name: "Soon",
        prompt: "Say hello",
        cron: "0 9 * * *",
        enabled: true,
        notify: false,
      },
      next,
    );
    assert.equal(db.getAgent(jira.id)?.nextRoutineAt, next);

    const created = db.createAgent({
      name: "Desk",
      description: "A short role",
      systemPrompt: "Reply briefly.",
      workspaceDir: null,
      model: AUTO_MODEL_ID,
    });
    assert.equal(created.description, "A short role");
    const updated = db.updateAgent(created.id, {
      name: created.name,
      description: "",
      systemPrompt: created.systemPrompt,
      workspaceDir: null,
      model: created.model,
    });
    assert.equal(updated.description, "");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
