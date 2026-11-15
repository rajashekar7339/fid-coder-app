// Editing and deleting chat turns without a Copilot call.
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

const sessions = [];

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

copilot.openSession = async (input) => {
  const entry = { input, prompts: [], pending: null };
  entry.session = {
    sendAndWait: async ({ prompt }) => {
      entry.prompts.push(prompt);
      const pending = deferred();
      entry.pending = pending;
      return pending.promise;
    },
    on: () => () => {},
    disconnect: async () => undefined,
    abort: async () => undefined,
  };
  sessions.push(entry);
  return { session: entry.session, unsubscribe: () => {} };
};

const { Runner } = require("../../dist/main/chat/runner.js");
const { AppDatabase } = require("../../dist/main/db/index.js");

async function waitFor(label, predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function withRunner(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-message-actions-"));
  const previousUserData = process.env.FID_CODER_USER_DATA;
  process.env.FID_CODER_USER_DATA = root;
  sessions.length = 0;
  const db = new AppDatabase(path.join(root, "app.sqlite"));
  const runner = new Runner(db, {}, { finalizeTurn: () => undefined });
  try {
    await run(db, runner, root);
  } finally {
    db.close();
    if (previousUserData === undefined) delete process.env.FID_CODER_USER_DATA;
    else process.env.FID_CODER_USER_DATA = previousUserData;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createAgent(db, workspaceDir = null) {
  return db.createAgent({
    name: "Message actions",
    systemPrompt: "Keep replies short.",
    workspaceDir,
    model: "auto",
    toolProfile: "developer",
    readOnly: false,
    memoryEnabled: false,
  });
}

function addTurn(db, agentId, user, assistant, source = "chat") {
  const turnId = db.createTurn(agentId, source);
  const userMessage = db.addMessage(agentId, "user", user, turnId);
  if (assistant) db.addMessage(agentId, "assistant", assistant, turnId);
  db.finishTurn(turnId, "ok");
  return { turnId, userMessage };
}

function userContents(db, agentId) {
  return db
    .listMessages(agentId)
    .filter((message) => message.role === "user")
    .map((message) => message.content);
}

test("edit rewinds that turn and every later turn, then reruns", async () => {
  await withRunner(async (db, runner, root) => {
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, "note.txt"), "attached note\n", "utf8");
    const agent = createAgent(db, workspace);
    db.setMemorySummary(agent.id, "Old summary with removed facts.", 2);

    addTurn(db, agent.id, "Before question", "Before answer");
    const first = db.createTurn(agent.id, "chat");
    const firstUser = db.addMessage(
      agent.id,
      "user",
      "First question",
      first,
      null,
      [{ kind: "workspace", path: "note.txt", name: "note.txt" }],
    );
    db.addMessage(agent.id, "assistant", "First answer", first);
    db.finishTurn(first, "ok");
    addTurn(db, agent.id, "Second question", "Second answer");

    const updated = await runner.editMessage({
      agentId: agent.id,
      messageId: firstUser.id,
      text: "Edited question",
    });
    assert.equal(updated.memorySummary, "");
    assert.deepEqual(userContents(db, agent.id), ["Before question", "Edited question"]);
    assert.equal(db.getMessage(firstUser.id), null);
    assert.equal(
      db.listMessages(agent.id).some((message) => message.content === "Second question"),
      false,
    );

    await waitFor("the edited turn", () => sessions.length === 1 && sessions[0].pending);
    const prompt = sessions[0].prompts[0];
    assert.match(prompt, /Before question/);
    assert.match(prompt, /Edited question/);
    assert.doesNotMatch(prompt, /First question|Second question|Old summary/);
    assert.match(prompt, /Attached files:/);
    assert.match(prompt, /note\.txt/);

    const editedUser = db.listMessages(agent.id).find((message) => message.content === "Edited question");
    assert.ok(editedUser?.turnId);
    assert.equal(editedUser.attachments?.[0]?.path, "note.txt");

    sessions[0].pending.resolve({ data: { content: "Edited answer" } });
    await waitFor(
      "the edited turn to finish",
      () => !runner.isRunning(agent.id) &&
        db.listMessages(agent.id).some((message) => message.content === "Edited answer"),
    );
    assert.deepEqual(userContents(db, agent.id), ["Before question", "Edited question"]);
  });
});

test("a pre-start edit failure leaves the history intact", async () => {
  await withRunner(async (db, runner) => {
    const agent = createAgent(db);
    const turn = addTurn(db, agent.id, "Keep this question", "Keep this answer");
    await assert.rejects(
      () => runner.editMessage({
        agentId: agent.id,
        messageId: turn.userMessage.id,
        text: "/help",
      }),
      /composer command/,
    );
    assert.deepEqual(userContents(db, agent.id), ["Keep this question"]);
    assert.ok(db.getMessage(turn.userMessage.id));
    assert.equal(db.listMessages(agent.id).some((message) => message.content === "Keep this answer"), true);
    assert.equal(sessions.length, 0);
  });
});

test("delete removes only that turn and keeps later chat", async () => {
  await withRunner(async (db, runner) => {
    const agent = createAgent(db);
    db.setMemorySummary(agent.id, "Old summary.", 1);
    addTurn(db, agent.id, "Before question", "Before answer");
    const first = addTurn(db, agent.id, "Delete this question", "Delete this answer");
    addTurn(db, agent.id, "Keep the later question", "Keep the later answer");
    db.addInboxItem({
      agentId: agent.id,
      kind: "turn",
      refId: first.turnId,
      title: "Failed turn",
      body: "Remove me with the turn.",
    });

    const updated = await runner.deleteMessage({
      agentId: agent.id,
      messageId: first.userMessage.id,
    });
    assert.equal(updated.memorySummary, "");
    assert.deepEqual(userContents(db, agent.id), ["Before question", "Keep the later question"]);
    assert.equal(db.getMessage(first.userMessage.id), null);
    assert.equal(db.getTurn(first.turnId), null);
    assert.equal(db.listMessages(agent.id).some((message) => message.content === "Delete this answer"), false);
    assert.equal(db.listMessages(agent.id).some((message) => message.content === "Keep the later answer"), true);
    assert.equal(db.listOpenInbox().length, 0);
  });
});

test("routine turns, assistant messages, and a running agent are refused", async () => {
  await withRunner(async (db, runner) => {
    const agent = createAgent(db);
    const routine = addTurn(db, agent.id, "[Routine] check", "Routine answer", "routine");
    await assert.rejects(
      () => runner.deleteMessage({ agentId: agent.id, messageId: routine.userMessage.id }),
      /read-only/,
    );
    const chat = addTurn(db, agent.id, "Chat question", "Chat answer");
    const assistant = db
      .listMessages(agent.id)
      .find((message) => message.role === "assistant" && message.turnId === chat.turnId);
    assert.ok(assistant);
    await assert.rejects(
      () => runner.deleteMessage({ agentId: agent.id, messageId: assistant.id }),
      /Only user messages/,
    );

    const pending = runner.runTurn({ agentId: agent.id, text: "Running now", source: "chat" });
    pending.catch(() => undefined);
    await waitFor("the running turn", () => sessions.length === 1 && sessions[0].pending);
    const runningUser = db
      .listMessages(agent.id)
      .filter((message) => message.role === "user")
      .at(-1);
    await assert.rejects(
      () => runner.editMessage({
        agentId: agent.id,
        messageId: runningUser.id,
        text: "Try to edit",
      }),
      /Stop the agent/,
    );
    sessions[0].pending.resolve({ data: { content: "Done" } });
    await pending;
  });
});
