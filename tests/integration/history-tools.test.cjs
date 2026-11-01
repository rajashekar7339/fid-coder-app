// Tests the SQLite-backed conversation history tools on a long transcript.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { AppDatabase } = require("../../dist/main/db/index.js");
const { createHistoryPort } = require("../../dist/main/history/history.js");
const { historyTools } = require("../../dist/tools/history/history.js");
const { allTools, toolsForAgent } = require("../../dist/tools/registry.js");

const history = Object.fromEntries(historyTools.map((tool) => [tool.name, tool]));

function localDay(iso) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-history-"));
  const file = path.join(dir, "app.sqlite");
  const db = new AppDatabase(file);
  const agent = db.createAgent({
    name: "History Agent",
    systemPrompt: "Use history.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "developer",
    memoryEnabled: true,
  });

  const raw = new DatabaseSync(file);
  const insertTurn = raw.prepare(
    "INSERT INTO turns (id, agent_id, source, started_at, ended_at, status) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertMessage = raw.prepare(
    "INSERT INTO messages (id, agent_id, role, content, created_at, turn_id) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (let index = 0; index < 100; index += 1) {
    const day = 1 + Math.floor(index / 10);
    const started = new Date(Date.UTC(2026, 9, day, 12, index % 60, 0, 0)).toISOString();
    const ended = new Date(Date.UTC(2026, 9, day, 12, index % 60, 30, 0)).toISOString();
    const turnId = `turn-${String(index).padStart(3, "0")}`;
    insertTurn.run(turnId, agent.id, "chat", started, ended, "ok");
    insertMessage.run(
      `user-${index}`,
      agent.id,
      "user",
      index === 50 ? "The timeout issue is back" : `Request ${index}`,
      started,
      turnId,
    );
    insertMessage.run(
      `assistant-${index}`,
      agent.id,
      "assistant",
      index === 50 ? "Fixed the timeout by retrying" : `Result ${index}`,
      ended,
      turnId,
    );
    insertMessage.run(`tool-${index}`, agent.id, "tool", `tool output ${index}`, ended, turnId);
  }
  insertMessage.run("old-user", agent.id, "user", "hi", "2026-09-01T12:00:00.000Z", null);
  insertMessage.run(
    "old-assistant",
    agent.id,
    "assistant",
    "Hi! What would you like help with?",
    "2026-09-01T12:00:05.000Z",
    null,
  );
  raw.close();

  return { dir, db, agent, port: createHistoryPort(db, agent.id) };
}

test("search, first, turn, and context read a long transcript", async () => {
  const { dir, db, port } = setup();
  try {
    const from = "2026-10-06T00:00:00.000Z";
    const to = "2026-10-06T23:59:59.999Z";

    const matches = await port.search({ query: "timeout", from, to, role: "all", limit: 10 });
    assert.ok(matches.length >= 2);
    assert.ok(matches.every((message) => message.content.toLowerCase().includes("timeout")));
    assert.ok(matches.every((message) => message.turnId === "turn-050"));

    const first = await port.first(1);
    assert.equal(first.length, 1);
    assert.equal(first[0].content, "hi");
    assert.equal(first[0].turnId, null);

    const detail = await port.turn("turn-050");
    assert.equal(detail.turn.messages, 3);
    assert.equal(detail.messages.length, 3);
    assert.match(detail.messages[1].content, /Fixed the timeout/);

    const context = await port.context({ from, to, limit: 100 });
    assert.equal(context.length, 20);
    assert.ok(context.every((message) => message.role !== "tool"));
    const withTools = await port.context({ from, to, limit: 100, includeTools: true });
    assert.equal(withTools.length, 30);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("history tools format the database for the model", async () => {
  const { dir, db, agent, port } = setup();
  const ctx = { agentId: agent.id, history: port };
  const targetDay = localDay("2026-10-06T12:50:00.000Z");
  try {
    const search = await history.history_search.handler(
      { query: "timeout", from: targetDay, to: targetDay, limit: 5 },
      ctx,
    );
    assert.match(search, /timeout/);
    assert.match(search, /turn-050/);

    const first = await history.history_first.handler({ limit: 1 }, ctx);
    assert.match(first, /user: hi/);

    const turn = await history.history_turn.handler({ turnId: "turn-050" }, ctx);
    assert.match(turn, /Turn turn-050/);
    assert.match(turn, /Fixed the timeout/);

    const context = await history.history_context.handler(
      { from: targetDay, to: targetDay, limit: 10 },
      ctx,
    );
    assert.match(context, /timeout issue/);
    assert.doesNotMatch(context, /tool output 50/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("history tools are on every agent profile", () => {
  const names = new Set(historyTools.map((tool) => tool.name));
  assert.deepEqual([...names].sort(), ["history_context", "history_first", "history_search", "history_turn"]);
  for (const profile of ["all", "browser", "developer"]) {
    const available = toolsForAgent(profile).map((tool) => tool.name);
    for (const name of names) assert.ok(available.includes(name), `${profile} is missing ${name}`);
  }
  const all = allTools().map((tool) => tool.name);
  for (const name of names) assert.ok(all.includes(name), `allTools is missing ${name}`);
});
