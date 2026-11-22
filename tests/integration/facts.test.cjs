// Facts are user data in the system message. Changing one drops the live session.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const secrets = require("../../dist/main/secrets.js");
secrets.hasSecret = () => false;
secrets.getSecret = () => null;

const { AppDatabase } = require("../../dist/main/db/index.js");
const { Runner } = require("../../dist/main/chat/runner.js");
const { createFact, updateFact, removeFact } = require("../../dist/main/facts/index.js");
const { FACTS_HEADING } = require("../../dist/shared/facts.js");

function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-facts-"));
  return { dir, db: new AppDatabase(path.join(dir, "app.sqlite")) };
}

function createAgent(db, name) {
  return db.createAgent({
    name,
    systemPrompt: "Keep replies short.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "developer",
    readOnly: false,
    memoryEnabled: true,
  });
}

test("the system message includes enabled facts and omits disabled ones", async () => {
  const { dir, db } = tempDatabase();
  try {
    const alpha = createAgent(db, "Alpha");
    const beta = createAgent(db, "Beta");
    db.insertFact({ agentId: alpha.id, content: "The release branch is main.", enabled: true });
    db.insertFact({ agentId: alpha.id, content: "Skip generated folders.", enabled: false });
    db.insertFact({ agentId: null, content: "Prefer short replies.", enabled: true });
    db.insertFact({ agentId: beta.id, content: "Beta only.", enabled: true });
    db.setMemorySummary(alpha.id, "Earlier work on the harness.", 4);

    const runner = new Runner(db, {}, {});
    const view = await runner.previewContext(alpha.id);
    assert.match(view.systemMessage, new RegExp(FACTS_HEADING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(view.systemMessage, /The release branch is main\./);
    assert.match(view.systemMessage, /Prefer short replies\./);
    assert.doesNotMatch(view.systemMessage, /Skip generated folders/);
    assert.doesNotMatch(view.systemMessage, /Beta only/);
    assert.doesNotMatch(view.systemMessage, /Earlier work on the harness/);
    assert.equal(view.memorySummary, "Earlier work on the harness.");
    const ownAt = view.systemMessage.indexOf("The release branch is main.");
    const sharedAt = view.systemMessage.indexOf("Prefer short replies.");
    assert.ok(ownAt >= 0 && ownAt < sharedAt);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saving a fact drops the idle sessions and leaves a running turn alone", async () => {
  const { dir, db } = tempDatabase();
  try {
    const alpha = createAgent(db, "Alpha");
    const beta = createAgent(db, "Beta");
    const dropped = [];
    const running = new Set();
    const runner = {
      async dropSession(agentId) {
        dropped.push(agentId);
      },
      isRunning(agentId) {
        return running.has(agentId);
      },
    };

    const created = await createFact(db, runner, {
      agentId: alpha.id,
      content: "  Run   npm test  before a handoff. ",
      shared: false,
      enabled: true,
    });
    assert.equal(created.agentId, alpha.id);
    assert.equal(created.content, "Run npm test before a handoff.");
    assert.equal(created.source, "user");
    assert.deepEqual(dropped, [alpha.id]);

    const edited = await updateFact(db, runner, created.id, { content: "Run npm test." });
    assert.equal(edited.agentId, alpha.id);
    assert.equal(edited.content, "Run npm test.");
    assert.deepEqual(dropped, [alpha.id, alpha.id]);

    const unchanged = await updateFact(db, runner, created.id, { content: "Run npm test." });
    assert.equal(unchanged.content, "Run npm test.");
    assert.deepEqual(dropped, [alpha.id, alpha.id], "an unchanged save keeps the session");

    running.add(beta.id);
    const beforeShared = dropped.length;
    const shared = await createFact(db, runner, {
      agentId: alpha.id,
      content: "Office hours start at 9.",
      shared: true,
    });
    assert.equal(shared.agentId, null);
    assert.deepEqual(db.listFacts(beta.id).map((fact) => fact.content), ["Office hours start at 9."]);
    const sharedDrops = dropped.slice(beforeShared);
    assert.ok(sharedDrops.includes(alpha.id), "an idle session is dropped");
    assert.ok(!sharedDrops.includes(beta.id), "the running beta session is kept");

    running.add(alpha.id);
    const beforeOwn = dropped.length;
    await createFact(db, runner, {
      agentId: alpha.id,
      content: "Use pnpm for this project.",
      shared: false,
    });
    assert.equal(dropped.length, beforeOwn, "a running agent keeps its session");

    await assert.rejects(
      () => createFact(db, runner, { agentId: alpha.id, content: `ghp_${"a".repeat(20)}`, shared: false }),
      /cannot store a token/,
    );

    running.clear();
    const beforeRemoval = dropped.length;
    const removed = await removeFact(db, runner, shared.id);
    assert.equal(removed.id, shared.id);
    assert.equal(db.getFact(shared.id), null);
    const removalDrops = dropped.slice(beforeRemoval);
    assert.ok(removalDrops.includes(alpha.id));
    assert.ok(removalDrops.includes(beta.id));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
