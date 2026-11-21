// Queue and force-send behavior without a Copilot call.
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
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    abort: async () => {
      const pending = entry.pending;
      entry.pending = null;
      pending?.reject(new Error("Aborted by test"));
    },
    disconnect: async () => undefined,
  };
  sessions.push(entry);
  return { session: entry.session, unsubscribe: () => {} };
};

const { Runner } = require("../../dist/main/chat/runner.js");
const { AppDatabase } = require("../../dist/main/db/index.js");
const { QUEUE_LIMIT } = require("../../dist/shared/message-queue.js");

async function waitFor(label, predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRunner(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-message-queue-"));
  const previousUserData = process.env.FID_CODER_USER_DATA;
  process.env.FID_CODER_USER_DATA = root;
  sessions.length = 0;
  const db = new AppDatabase(path.join(root, "app.sqlite"));
  const runner = new Runner(db, {}, { finalizeTurn: () => undefined });
  const events = [];
  runner.setSink((event) => events.push(event));
  try {
    await run({ db, runner, events });
  } finally {
    db.close();
    if (previousUserData === undefined) delete process.env.FID_CODER_USER_DATA;
    else process.env.FID_CODER_USER_DATA = previousUserData;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createAgent(db, name = "Queue") {
  return db.createAgent({
    name,
    systemPrompt: "Help.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly: true,
    memoryEnabled: false,
  });
}

function start(runner, agentId, text) {
  const promise = runner.runTurn({ agentId, text, source: "chat" });
  promise.catch(() => undefined);
  return promise;
}

function resolveTurn(index, content) {
  const entry = sessions[index];
  assert.ok(entry?.pending, `session ${index} has a pending turn`);
  const pending = entry.pending;
  entry.pending = null;
  pending.resolve({ data: { content } });
}

function userEvents(events) {
  return events.filter((event) => event.type === "user").map((event) => event.text);
}

test("queued messages run in order after the current turn", async () => {
  await withRunner(async ({ db, runner, events }) => {
    const agent = createAgent(db);
    const first = start(runner, agent.id, "first");
    await waitFor("the first turn", () => sessions.length === 1 && sessions[0].pending);

    runner.enqueue({ agentId: agent.id, text: "second" });
    const both = runner.enqueue({ agentId: agent.id, text: "third" });
    assert.deepEqual(both.map((item) => item.text), ["second", "third"]);
    assert.deepEqual(
      events.filter((event) => event.type === "queue").at(-1).queue.map((item) => item.text),
      ["second", "third"],
    );

    resolveTurn(0, "one");
    assert.equal(await first, "one");
    await waitFor("the second turn", () => sessions[0].prompts.length === 2 && sessions[0].pending);
    assert.match(sessions[0].prompts[1], /second/);
    assert.deepEqual(runner.listQueue(agent.id).map((item) => item.text), ["third"]);

    resolveTurn(0, "two");
    await waitFor("the third turn", () => sessions[0].prompts.length === 3 && sessions[0].pending);
    assert.match(sessions[0].prompts[2], /third/);

    resolveTurn(0, "three");
    await waitFor(
      "the empty queue",
      () => runner.listQueue(agent.id).length === 0 && !runner.isRunning(agent.id),
    );
    assert.deepEqual(userEvents(events), ["first", "second", "third"]);
    assert.deepEqual(
      db
        .listMessages(agent.id)
        .filter((message) => message.role === "user")
        .map((message) => message.content),
      ["first", "second", "third"],
    );
    assert.deepEqual(
      events.filter((event) => event.type === "queue").map((event) => event.queue.length),
      [1, 2, 1, 0],
    );
  });
});

test("remove and clear leave the current turn alone", async () => {
  await withRunner(async ({ db, runner }) => {
    const agent = createAgent(db);
    const first = start(runner, agent.id, "first");
    await waitFor("the first turn", () => sessions.length === 1 && sessions[0].pending);

    const firstQueued = runner.enqueue({ agentId: agent.id, text: "keep" })[0];
    runner.enqueue({ agentId: agent.id, text: "remove me" });
    assert.deepEqual(
      runner.removeQueued(agent.id, firstQueued.id).map((item) => item.text),
      ["remove me"],
    );
    assert.deepEqual(runner.clearQueue(agent.id), []);
    assert.equal(runner.listQueue(agent.id).length, 0);

    resolveTurn(0, "one");
    assert.equal(await first, "one");
    await sleep(100);
    assert.equal(sessions[0].prompts.length, 1);
  });
});

test("a queued attachment reaches the next turn", async () => {
  await withRunner(async ({ db, runner }) => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "fid-queue-workspace-"));
    try {
      fs.writeFileSync(path.join(workspace, "note.txt"), "queued note\n", "utf8");
      const agent = db.createAgent({
        name: "Attachment Queue",
        systemPrompt: "Help.",
        workspaceDir: workspace,
        model: "auto",
        toolProfile: "developer",
        readOnly: true,
        memoryEnabled: false,
      });
      const first = start(runner, agent.id, "first");
      await waitFor("the first turn", () => sessions.length === 1 && sessions[0].pending);
      const [queued] = runner.enqueue({
        agentId: agent.id,
        text: "second",
        attachments: [{ kind: "workspace", path: "note.txt", name: "note.txt" }],
      });
      assert.equal(queued.attachments.length, 1);
      resolveTurn(0, "one");
      assert.equal(await first, "one");
      await waitFor("the attached turn", () => sessions[0].prompts.length === 2 && sessions[0].pending);
      assert.match(sessions[0].prompts[1], /Attached files:/);
      assert.match(sessions[0].prompts[1], /note\.txt/);
      resolveTurn(0, "two");
      await waitFor("the empty queue", () => runner.listQueue(agent.id).length === 0);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

test("edit keeps the queued position and refuses an empty message", async () => {
  await withRunner(async ({ db, runner }) => {
    const agent = createAgent(db);
    const first = start(runner, agent.id, "first");
    await waitFor("the first turn", () => sessions.length === 1 && sessions[0].pending);

    const one = runner.enqueue({ agentId: agent.id, text: "one" })[0];
    runner.enqueue({ agentId: agent.id, text: "two" });
    const edited = runner.updateQueued(agent.id, one.id, "  edited  ");
    assert.deepEqual(edited.map((item) => item.text), ["edited", "two"]);
    assert.equal(edited[0].id, one.id);
    assert.throws(() => runner.updateQueued(agent.id, one.id, "   "), /Message is empty/);
    assert.throws(() => runner.updateQueued(agent.id, "missing", "text"), /no longer queued/);

    runner.removeQueued(agent.id, one.id);
    assert.throws(() => runner.updateQueued(agent.id, one.id, "after remove"), /no longer queued/);
    runner.clearQueue(agent.id);
    resolveTurn(0, "one");
    assert.equal(await first, "one");
    await sleep(100);
    assert.equal(sessions[0].prompts.length, 1);
  });
});

test("Stop keeps the queue paused until a later turn succeeds", async () => {
  await withRunner(async ({ db, runner, events }) => {
    const agent = createAgent(db);
    const first = start(runner, agent.id, "first");
    await waitFor("the first turn", () => sessions.length === 1 && sessions[0].pending);
    runner.enqueue({ agentId: agent.id, text: "later" });

    await runner.abort(agent.id);
    await assert.rejects(() => first, /Stopped by the user/);
    await waitFor("the stopped turn", () => !runner.isRunning(agent.id));
    assert.deepEqual(runner.listQueue(agent.id).map((item) => item.text), ["later"]);
    await sleep(100);
    assert.equal(sessions[0].prompts.length, 1);
    const stopped = events.filter((event) => event.type === "error").at(-1);
    assert.equal(stopped.error, "Stopped by the user.");
    assert.equal(stopped.aborted, true);

    const manual = start(runner, agent.id, "manual");
    await waitFor("the manual turn", () => sessions[0].prompts.length === 2 && sessions[0].pending);
    resolveTurn(0, "two");
    assert.equal(await manual, "two");
    await waitFor("the queued turn", () => sessions[0].prompts.length === 3 && sessions[0].pending);
    assert.match(sessions[0].prompts[2], /later/);
    resolveTurn(0, "three");
    await waitFor("the empty queue", () => runner.listQueue(agent.id).length === 0);
  });
});

test("forceSend stops the current turn and starts the new message", async () => {
  await withRunner(async ({ db, runner, events }) => {
    const agent = createAgent(db);
    const first = start(runner, agent.id, "first");
    await waitFor("the first turn", () => sessions.length === 1 && sessions[0].pending);
    runner.enqueue({ agentId: agent.id, text: "later" });

    const forced = runner.forceSend({ agentId: agent.id, text: "forced" });
    await forced;
    await waitFor("the forced turn", () => sessions[0].prompts.length === 2 && sessions[0].pending);
    assert.match(sessions[0].prompts[1], /forced/);
    assert.deepEqual(runner.listQueue(agent.id).map((item) => item.text), ["later"]);
    assert.deepEqual(userEvents(events), ["first", "forced"]);
    const stopped = events.find((event) => event.type === "error");
    assert.equal(stopped.error, "Stopped by the user.");
    assert.equal(stopped.aborted, true);
    await assert.rejects(() => first, /Stopped by the user/);

    resolveTurn(0, "forced answer");
    await waitFor("the queued turn", () => sessions[0].prompts.length === 3 && sessions[0].pending);
    assert.match(sessions[0].prompts[2], /later/);
    resolveTurn(0, "later answer");
    await waitFor("the empty queue", () => runner.listQueue(agent.id).length === 0);
  });
});

test("forceQueued sends one queued message and keeps the rest", async () => {
  await withRunner(async ({ db, runner, events }) => {
    const agent = createAgent(db);
    const first = start(runner, agent.id, "first");
    await waitFor("the first turn", () => sessions.length === 1 && sessions[0].pending);
    runner.enqueue({ agentId: agent.id, text: "first queued" });
    const secondQueued = runner.enqueue({ agentId: agent.id, text: "second queued" })[1];

    await runner.forceQueued(agent.id, secondQueued.id);
    await waitFor("the forced queued turn", () => sessions[0].prompts.length === 2 && sessions[0].pending);
    assert.match(sessions[0].prompts[1], /second queued/);
    assert.deepEqual(runner.listQueue(agent.id).map((item) => item.text), ["first queued"]);
    await assert.rejects(() => first, /Stopped by the user/);

    resolveTurn(0, "second answer");
    await waitFor("the remaining queued turn", () => sessions[0].prompts.length === 3 && sessions[0].pending);
    assert.match(sessions[0].prompts[2], /first queued/);
    resolveTurn(0, "first answer");
    await waitFor("the empty queue", () => runner.listQueue(agent.id).length === 0);
    assert.deepEqual(userEvents(events), ["first", "second queued", "first queued"]);
  });
});

test("a pre-start failure keeps the queued message", async () => {
  await withRunner(async ({ db, runner, events }) => {
    const agent = createAgent(db);
    runner.enqueue({ agentId: agent.id, text: "/help" });
    await waitFor("the composer-command error", () =>
      events.some((event) => event.type === "error" && /composer command/.test(event.error)),
    );
    assert.equal(sessions.length, 0);
    assert.deepEqual(runner.listQueue(agent.id).map((item) => item.text), ["/help"]);
    runner.removeQueued(agent.id, runner.listQueue(agent.id)[0].id);
    assert.equal(runner.listQueue(agent.id).length, 0);
  });
});

test("the queue is capped and an idle enqueue starts at once", async () => {
  await withRunner(async ({ db, runner }) => {
    const agent = createAgent(db);
    const first = start(runner, agent.id, "first");
    await waitFor("the first turn", () => sessions.length === 1 && sessions[0].pending);
    for (let index = 0; index < QUEUE_LIMIT; index += 1) {
      runner.enqueue({ agentId: agent.id, text: `queued ${index}` });
    }
    assert.throws(
      () => runner.enqueue({ agentId: agent.id, text: "too many" }),
      /queue is full/,
    );
    runner.clearQueue(agent.id);
    resolveTurn(0, "one");
    assert.equal(await first, "one");
    await sleep(100);
    assert.equal(sessions[0].prompts.length, 1);
  });
});

test("an idle enqueue starts without a queue event gap", async () => {
  await withRunner(async ({ db, runner, events }) => {
    const agent = createAgent(db);
    const queued = runner.enqueue({ agentId: agent.id, text: "hello" });
    assert.equal(queued.length, 1);
    await waitFor("the first turn", () => sessions.length === 1 && sessions[0].pending);
    assert.match(sessions[0].prompts[0], /hello/);
    resolveTurn(0, "hi");
    await waitFor("the empty queue", () => runner.listQueue(agent.id).length === 0);
    assert.deepEqual(userEvents(events), ["hello"]);
  });
});

test("runningAgentIds lists every active turn", async () => {
  await withRunner(async ({ db, runner }) => {
    const agent = createAgent(db);
    assert.deepEqual(runner.runningAgentIds(), []);

    const first = start(runner, agent.id, "first");
    await waitFor("the first turn", () => sessions.length === 1 && sessions[0].pending);
    assert.deepEqual(runner.runningAgentIds(), [agent.id]);

    resolveTurn(0, "one");
    assert.equal(await first, "one");
    await waitFor("the turn to end", () => !runner.isRunning(agent.id));
    assert.deepEqual(runner.runningAgentIds(), []);

    const assistant = db.listMessages(agent.id).find((message) => message.role === "assistant");
    assert.ok(assistant?.turnStartedAt, "the reply carries its turn start");
    assert.ok(assistant?.turnEndedAt, "the reply carries its turn end");
  });
});
