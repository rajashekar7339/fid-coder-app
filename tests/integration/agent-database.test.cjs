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

test("the old guide permission sentence is removed from saved prompts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-guide-prompt-"));
  const file = path.join(dir, "app.sqlite");
  const oldPrompt =
    "You are a codebase guide. Answer questions about this repository. Read the code before you answer, cite evidence as path:line, and use Mermaid diagrams for flows. Do not edit files or run commands. If the user wants a change, tell them to switch to Code.";
  const newPrompt =
    "You are a codebase guide. Answer questions about this repository. Read the code before you answer, cite evidence as path:line, and use Mermaid diagrams for flows.";
  const customPrompt = "You are a release assistant. Do not edit files without asking.";
  let guideId;
  let customId;
  try {
    const db = new AppDatabase(file);
    try {
      guideId = db.createAgent({
        name: "Old guide",
        systemPrompt: oldPrompt,
        workspaceDir: null,
        model: "auto",
      }).id;
      customId = db.createAgent({
        name: "Custom guide",
        systemPrompt: customPrompt,
        workspaceDir: null,
        model: "auto",
      }).id;
    } finally {
      db.close();
    }

    const reopened = new AppDatabase(file);
    try {
      assert.equal(reopened.getAgent(guideId).systemPrompt, newPrompt);
      assert.equal(reopened.getAgent(customId).systemPrompt, customPrompt);
    } finally {
      reopened.close();
    }
  } finally {
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
    const datadog = agents.find((agent) => agent.name === "Datadog Analyst");
    assert.equal(datadog?.description, "Logs, metrics, and root cause");
    assert.equal(datadog?.toolProfile, "datadog");
    assert.match(datadog?.systemPrompt ?? "", /datadog-triage/);
    assert.ok(agents.every((agent) => agent.lastActivityAt === null));
    assert.ok(agents.every((agent) => agent.pinned === false && agent.archived === false));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a saved native Datadog prompt moves to browser mode", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-datadog-prompt-"));
  const file = path.join(dir, "app.sqlite");
  try {
    const db = new AppDatabase(file);
    const datadog = db.listAgents().find((agent) => agent.name === "Datadog Analyst");
    assert.ok(datadog);
    db.updateAgent(datadog.id, {
      name: datadog.name,
      description: datadog.description,
      systemPrompt:
        "You are a Datadog analyst. Use datadog_logs_search and datadog_logs_aggregate with an API key.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "datadog",
      readOnly: false,
      memoryEnabled: false,
    });
    db.close();

    const reopened = new AppDatabase(file);
    try {
      const upgraded = reopened.listAgents().find((agent) => agent.id === datadog.id);
      assert.match(upgraded.systemPrompt, /datadog_browser_logs/);
      assert.doesNotMatch(upgraded.systemPrompt, /datadog_logs_search/);
    } finally {
      reopened.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the seeded Datadog agent is added once and stays deleted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-datadog-seed-"));
  const file = path.join(dir, "app.sqlite");
  try {
    const db = new AppDatabase(file);
    const datadog = db.listAgents().find((agent) => agent.name === "Datadog Analyst");
    assert.ok(datadog);
    db.deleteAgent(datadog.id);
    assert.equal(db.listAgents().some((agent) => agent.name === "Datadog Analyst"), false);
    db.close();

    const reopened = new AppDatabase(file);
    try {
      assert.equal(reopened.listAgents().some((agent) => agent.name === "Datadog Analyst"), false);
    } finally {
      reopened.close();
    }
  } finally {
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

test("an older database with a skill_ids column still loads and updates agents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skills-"));
  const file = path.join(dir, "app.sqlite");
  const id = "22222222-2222-4222-8222-222222222222";
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      workspace_dir TEXT,
      skill_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  raw
    .prepare(
      "INSERT INTO agents (id, name, system_prompt, workspace_dir, skill_ids, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?)",
    )
    .run(id, "Old skills", "Write code.", '["write-lean"]', "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  raw.close();

  const db = new AppDatabase(file);
  try {
    const agent = db.getAgent(id);
    assert.equal(agent.name, "Old skills");
    assert.equal(agent.skillIds, undefined);
    assert.equal(agent.pinned, false);
    assert.equal(agent.archived, false);
    const updated = db.updateAgent(id, {
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      workspaceDir: agent.workspaceDir,
      model: agent.model,
      toolProfile: agent.toolProfile,
      memoryEnabled: agent.memoryEnabled,
    });
    assert.equal(updated.name, "Old skills");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pin and archive keep the agent, survive an edit, and sort pinned first", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-place-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const input = (name) => ({
    name,
    description: "",
    systemPrompt: "Reply briefly.",
    workspaceDir: null,
    model: AUTO_MODEL_ID,
    toolProfile: "browser",
    readOnly: true,
    memoryEnabled: false,
  });
  try {
    const pinned = db.createAgent(input("Zebra"));
    await wait(40);
    const older = db.createAgent(input("Alpha"));
    await wait(40);
    const newer = db.createAgent(input("Middling"));
    assert.ok(newer.updatedAt > older.updatedAt);
    assert.equal(pinned.pinned, false);
    assert.equal(pinned.archived, false);

    const marked = db.placeAgent(pinned.id, { pinned: true });
    assert.equal(marked.pinned, true);
    assert.equal(marked.updatedAt, pinned.updatedAt);
    const namesOf = () =>
      db
        .listAgents()
        .filter((agent) => agent.name === "Zebra" || agent.name === "Alpha" || agent.name === "Middling")
        .map((agent) => agent.name);
    assert.deepEqual(namesOf(), ["Zebra", "Middling", "Alpha"]);

    const hidden = db.placeAgent(newer.id, { archived: true });
    assert.equal(hidden.archived, true);
    assert.equal(hidden.pinned, false);
    const edited = db.updateAgent(hidden.id, { ...input("Middling"), description: "Kept" });
    assert.equal(edited.archived, true);
    assert.equal(edited.description, "Kept");
    assert.deepEqual(namesOf(), ["Zebra", "Alpha", "Middling"]);

    const restored = db.placeAgent(hidden.id, { archived: false });
    assert.equal(restored.archived, false);
    assert.equal(restored.pinned, false);
    const stillPinned = db.placeAgent(pinned.id, { archived: true });
    assert.equal(stillPinned.pinned, true);
    assert.equal(stillPinned.archived, true);
    assert.throws(() => db.placeAgent("missing-agent", { pinned: true }), /Agent not found/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("messages keep token usage and add the column on an older database", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-usage-"));
  const file = path.join(dir, "app.sqlite");
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  raw.close();

  const db = new AppDatabase(file);
  try {
    const agent = db.createAgent({
      name: "Usage",
      systemPrompt: "Reply briefly.",
      workspaceDir: null,
      model: AUTO_MODEL_ID,
    });
    const usage = {
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 640,
      cacheWriteTokens: 0,
      reasoningTokens: 40,
      modelCalls: 2,
      model: "gpt-5",
      isAuto: false,
      nanoAiu: 12_000_000,
      creditCalls: 2,
      creditStatus: "complete",
    };
    const saved = db.addMessage(agent.id, "assistant", "Hello", null, usage);
    assert.deepEqual(saved.usage, usage);
    const found = db.listMessages(agent.id).find((message) => message.id === saved.id);
    assert.deepEqual(found?.usage, { ...usage, provider: "copilot" });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("records used skills per agent and removes them with the agent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-agent-skills-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const agent = db.createAgent({
      name: "Skill memory",
      systemPrompt: "Reply briefly.",
      workspaceDir: null,
      model: AUTO_MODEL_ID,
    });
    db.markSkillUsed(agent.id, "review-change");
    db.markSkillUsed(agent.id, "write-lean");
    assert.deepEqual(db.listUsedSkillIds(agent.id), ["write-lean", "review-change"]);
    db.markSkillUsed(agent.id, "review-change");
    assert.deepEqual(db.listUsedSkillIds(agent.id), ["review-change", "write-lean"]);
    assert.deepEqual(db.listUsedSkillIds(agent.id, 1), ["review-change"]);
    db.deleteAgent(agent.id);
    assert.deepEqual(db.listUsedSkillIds(agent.id), []);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("lists the most recent user and assistant messages for enhance context", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-recent-conversation-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const agent = db.createAgent({
      name: "Enhance context",
      systemPrompt: "Reply briefly.",
      workspaceDir: null,
      model: AUTO_MODEL_ID,
    });
    db.addMessage(agent.id, "user", "one");
    db.addMessage(agent.id, "assistant", "two");
    db.addMessage(agent.id, "tool", "tool output");
    db.addMessage(agent.id, "user", "three");
    db.addMessage(agent.id, "assistant", "four");
    db.addMessage(agent.id, "user", "five");
    assert.deepEqual(
      db.listRecentConversation(agent.id).map((message) => `${message.role}:${message.content}`),
      ["assistant:two", "user:three", "assistant:four", "user:five"],
    );
    assert.deepEqual(
      db.listRecentConversation(agent.id, 2).map((message) => `${message.role}:${message.content}`),
      ["assistant:four", "user:five"],
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stores Ask mode and the cached project map", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-ask-map-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const agent = db.createAgent({
      name: "Guide",
      systemPrompt: "Answer from the code.",
      workspaceDir: dir,
      model: "auto",
      toolProfile: "developer",
      readOnly: true,
      memoryEnabled: false,
    });
    assert.equal(agent.readOnly, true);
    const updated = db.updateAgent(agent.id, {
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      workspaceDir: agent.workspaceDir,
      model: agent.model,
      toolProfile: agent.toolProfile,
      readOnly: false,
      memoryEnabled: false,
    });
    assert.equal(updated.readOnly, false);

    assert.equal(db.getWorkspaceMap(dir), null);
    const first = db.setWorkspaceMap(dir, "key-1", "# Map\n\nFirst.");
    assert.equal(first.cacheKey, "key-1");
    assert.equal(db.getWorkspaceMap(dir).text, "# Map\n\nFirst.");
    const second = db.setWorkspaceMap(dir, "key-2", "# Map\n\nSecond.");
    assert.equal(second.cacheKey, "key-2");
    assert.equal(db.getWorkspaceMap(dir).text, "# Map\n\nSecond.");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

