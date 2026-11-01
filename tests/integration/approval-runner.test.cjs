// Tests the out-of-band approval bridge used by shell_run.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AppDatabase } = require("../../dist/main/db/index.js");
const { Runner } = require("../../dist/main/chat/runner.js");

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-approval-runner-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  const agent = db.createAgent({
    name: "Shell Agent",
    systemPrompt: "Run commands.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "developer",
  });
  const runner = new Runner(db, {}, {});
  const events = [];
  runner.setSink((event) => events.push(event));
  return { dir, db, agent, runner, events };
}

function request(overrides = {}) {
  return {
    kind: "shell",
    title: "Run a sensitive command?",
    command: "del notes.tmp",
    cwd: "D:\\repo",
    reason: "This deletes files or data.",
    ...overrides,
  };
}

test("approve once resolves the tool and records the decision", async () => {
  const { dir, db, agent, runner, events } = setup();
  try {
    const pending = runner.requestApproval(agent.id, request());
    const item = runner.listPendingApprovals(agent.id)[0];
    assert.ok(item);
    assert.equal(events.filter((event) => event.type === "approval-request").length, 1);

    assert.equal(runner.resolveApproval(item.id, "approve"), true);
    const outcome = await pending;
    assert.equal(outcome.approved, true);
    assert.equal(outcome.source, "user");
    assert.equal(runner.listPendingApprovals(agent.id).length, 0);
    assert.equal(events.filter((event) => event.type === "approval-resolved").length, 1);

    const record = db.listApprovals(agent.id, 10)[0];
    assert.equal(record.decision, "allow");
    assert.equal(record.source, "user");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("always allow saves a rule and auto-approves the next match", async () => {
  const { dir, db, agent, runner } = setup();
  try {
    const first = runner.requestApproval(agent.id, request({ command: "npm test" }));
    const item = runner.listPendingApprovals(agent.id)[0];
    runner.resolveApproval(item.id, "always-allow");
    await first;

    const rule = db.findApprovalRule(agent.id, "shell", "npm test", "D:\\repo");
    assert.equal(rule.decision, "allow");

    const outcome = await runner.requestApproval(agent.id, request({ command: "  NPM   test " }));
    assert.equal(outcome.approved, true);
    assert.equal(outcome.source, "rule");
    assert.equal(runner.listPendingApprovals(agent.id).length, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("always deny saves a deny rule that wins over an allow rule", async () => {
  const { dir, db, agent, runner } = setup();
  try {
    const first = runner.requestApproval(agent.id, request({ command: "git push" }));
    const item = runner.listPendingApprovals(agent.id)[0];
    runner.resolveApproval(item.id, "always-deny");
    const outcome = await first;
    assert.equal(outcome.approved, false);

    db.createApprovalRule({
      agentId: agent.id,
      kind: "shell",
      decision: "allow",
      match: "git push",
      cwd: "D:\\repo",
    });
    const rules = db.listApprovalRules(agent.id);
    assert.equal(rules.length, 2);
    const next = await runner.requestApproval(agent.id, request({ command: "git push" }));
    assert.equal(next.approved, false);
    assert.equal(next.source, "rule");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stopping a turn denies every pending approval for that agent", async () => {
  const { dir, db, agent, runner } = setup();
  try {
    const pending = runner.requestApproval(agent.id, request());
    runner.denyPendingApprovals(agent.id, "Stopped by the user.");
    const outcome = await pending;
    assert.equal(outcome.approved, false);
    assert.equal(outcome.source, "aborted");
    assert.equal(runner.listPendingApprovals(agent.id).length, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
