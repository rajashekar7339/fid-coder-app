// The question card asks, answers, skips, and closes without a Copilot call.
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
let behavior = async () => ({ data: { content: "answer" } });
copilot.openSession = async (input) => ({
  session: {
    sendAndWait: () => behavior(input),
    on: () => () => {},
    disconnect: async () => undefined,
    abort: async () => undefined,
  },
  unsubscribe: () => {},
});

const { Runner } = require("../../dist/main/chat/runner.js");
const { AppDatabase } = require("../../dist/main/db/index.js");
const { QUESTION_HINT } = require("../../dist/shared/question.js");

async function withRunner(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-ask-user-"));
  const previousUserData = process.env.FID_CODER_USER_DATA;
  process.env.FID_CODER_USER_DATA = root;
  const db = new AppDatabase(path.join(root, "app.sqlite"));
  const runner = new Runner(db, {}, { finalizeTurn: () => undefined });
  try {
    await run(db, runner);
  } finally {
    db.close();
    if (previousUserData === undefined) delete process.env.FID_CODER_USER_DATA;
    else process.env.FID_CODER_USER_DATA = previousUserData;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createAgent(db, readOnly = false) {
  return db.createAgent({
    name: "Asker",
    systemPrompt: "Help.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly,
    memoryEnabled: false,
  });
}

function askTool(input) {
  const tool = input.tools.find((item) => item.name === "ask_user");
  assert.ok(tool, "ask_user is registered");
  return tool;
}

test("a choice, an other answer, and a skip return to the agent", async () => {
  await withRunner(async (db, runner) => {
    const agent = createAgent(db);
    const events = [];
    runner.setSink((event) => {
      if (event.type === "question-request" || event.type === "question-resolved") events.push(event);
    });
    const notes = [];

    behavior = async (input) => {
      const tool = askTool(input);
      const ctx = input.getContext();
      const chosen = tool.handler({ question: " Ship it? ", choices: [" Now ", "Later"] }, ctx);
      const pending = runner.listPendingQuestions(agent.id);
      assert.equal(pending.length, 1);
      assert.deepEqual(pending[0].choices, ["Now", "Later"]);
      assert.equal(runner.resolveQuestion(pending[0].id, { kind: "choice", index: 1 }), true);
      assert.equal(await chosen, "The user chose: Later");

      const other = tool.handler({ question: "When?", choices: ["Today", "Tomorrow"] }, ctx);
      const otherId = runner.listPendingQuestions(agent.id)[0].id;
      assert.throws(() => runner.resolveQuestion(otherId, { kind: "other", text: "   " }), /Type an answer/);
      assert.equal(runner.listPendingQuestions(agent.id).length, 1);
      runner.resolveQuestion(otherId, { kind: "other", text: "  next week  " });
      assert.equal(await other, "The user answered in their own words: next week");

      const skipped = tool.handler({ question: "Which log?", choices: ["App", "Build"] }, ctx);
      const first = runner.listPendingQuestions(agent.id)[0];
      await assert.rejects(
        () => tool.handler({ question: "Another?", choices: ["A", "B"] }, ctx),
        /already waiting/,
      );
      runner.resolveQuestion(first.id, { kind: "skip" });
      assert.match(await skipped, /No answer/);
      assert.equal(runner.listPendingQuestions(agent.id).length, 0);
      return { data: { content: "Continuing." } };
    };

    const view = await runner.previewContext(agent.id);
    assert.equal(view.tools.includes("ask_user"), true);
    assert.match(view.systemMessage, /call ask_user once/);
    assert.equal(await runner.runTurn({ agentId: agent.id, text: "Help me ship.", source: "chat", notify: (text) => notes.push(text) }), "Continuing.");
    assert.ok(notes.some((note) => note.startsWith("Needs an answer:")));
    assert.deepEqual(
      events.map((event) => event.type),
      ["question-request", "question-resolved", "question-request", "question-resolved", "question-request", "question-resolved"],
    );
  });
});

test("stopping the turn closes the question", async () => {
  await withRunner(async (db, runner) => {
    const agent = createAgent(db);
    behavior = async (input) => {
      const tool = askTool(input);
      const pending = tool.handler({ question: "Ship it?", choices: ["Now", "Later"] }, input.getContext());
      const closing = runner.abort(agent.id);
      await assert.rejects(pending, /closed before an answer/);
      await closing;
      assert.equal(runner.listPendingQuestions(agent.id).length, 0);
      return { data: { content: "stopped" } };
    };
    assert.equal(await runner.runTurn({ agentId: agent.id, text: "Help me ship.", source: "chat" }), "stopped");
  });
});

test("the routine command does not get ask_user", async () => {
  await withRunner(async (db, runner) => {
    const agent = createAgent(db, false);
    let seen = null;
    behavior = async (input) => {
      seen = input;
      return { data: { content: "Created." } };
    };
    assert.equal(
      await runner.runTurn({
        agentId: agent.id,
        text: "/routine Check the build every weekday at 9:00",
        source: "chat",
      }),
      "Created.",
    );
    assert.deepEqual(seen.tools.map((tool) => tool.name), ["routine_create"]);
    assert.equal(seen.systemMessage.includes(QUESTION_HINT), false);
  });
});
