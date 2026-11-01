// Tests approval audit rows and saved allow/deny rules.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AppDatabase } = require("../../dist/main/db/index.js");

function database() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-approvals-"));
  return { dir, db: new AppDatabase(path.join(dir, "app.sqlite")) };
}

test("records a pending approval and its decision", () => {
  const { dir, db } = database();
  try {
    const agent = db.createAgent({
      name: "Shell Agent",
      systemPrompt: "Run commands.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
    });
    db.createApproval({
      id: "approval-1",
      agentId: agent.id,
      turnId: null,
      kind: "shell",
      command: "del notes.tmp",
      cwd: "D:\\repo",
      reason: "This deletes files or data.",
    });
    const pending = db.listApprovals(agent.id, 10);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].decision, "pending");
    assert.equal(pending[0].source, null);
    assert.equal(pending[0].agentName, "Shell Agent");

    db.resolveApproval("approval-1", "deny", "user");
    const resolved = db.listApprovals(agent.id, 10)[0];
    assert.equal(resolved.decision, "deny");
    assert.equal(resolved.source, "user");
    assert.ok(resolved.decidedAt);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deny rules win over allow rules", () => {
  const { dir, db } = database();
  try {
    const agent = db.createAgent({
      name: "Shell Agent",
      systemPrompt: "Run commands.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
    });
    const allow = db.createApprovalRule({
      agentId: agent.id,
      kind: "shell",
      decision: "allow",
      match: "  git   push origin main ",
      cwd: "D:\\repo",
    });
    assert.equal(allow.match, "git push origin main");

    const deny = db.createApprovalRule({
      agentId: agent.id,
      kind: "shell",
      decision: "deny",
      match: "git push origin main",
      cwd: "D:\\repo",
    });
    assert.equal(deny.decision, "deny");

    const found = db.findApprovalRule(agent.id, "shell", "GIT PUSH ORIGIN MAIN", "D:\\repo");
    assert.equal(found.decision, "deny");
    assert.equal(db.listApprovalRules(agent.id).length, 2);

    db.deleteApprovalRule(deny.id);
    const allowOnly = db.findApprovalRule(agent.id, "shell", "git push origin main", "D:\\repo");
    assert.equal(allowOnly.decision, "allow");
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rules do not match a different folder", () => {
  const { dir, db } = database();
  try {
    const agent = db.createAgent({
      name: "Shell Agent",
      systemPrompt: "Run commands.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
    });
    db.createApprovalRule({
      agentId: agent.id,
      kind: "shell",
      decision: "allow",
      match: "npm test",
      cwd: "D:\\repo",
    });
    assert.ok(db.findApprovalRule(agent.id, "shell", "npm test", "D:\\repo"));
    assert.equal(db.findApprovalRule(agent.id, "shell", "npm test", "D:\\other"), null);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a pending approval left by a crash is closed on startup", () => {
  const { dir, db } = database();
  let agentId = "";
  try {
    const agent = db.createAgent({
      name: "Shell Agent",
      systemPrompt: "Run commands.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
    });
    agentId = agent.id;
    db.createApproval({
      id: "approval-crash",
      agentId,
      turnId: null,
      kind: "shell",
      command: "git push",
      cwd: "D:\\repo",
      reason: "This pushes commits to a remote repository.",
    });
  } finally {
    db.close();
  }

  const reopened = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const record = reopened.listApprovals(agentId, 10)[0];
    assert.equal(record.decision, "deny");
    assert.equal(record.source, "aborted");
    assert.ok(record.decidedAt);
  } finally {
    reopened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deleting an agent removes its approvals and rules", () => {
  const { dir, db } = database();
  try {
    const agent = db.createAgent({
      name: "Shell Agent",
      systemPrompt: "Run commands.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
    });
    db.createApproval({
      id: "approval-2",
      agentId: agent.id,
      turnId: null,
      kind: "shell",
      command: "git push",
      cwd: "D:\\repo",
      reason: "This pushes commits to a remote repository.",
    });
    db.createApprovalRule({
      agentId: agent.id,
      kind: "shell",
      decision: "allow",
      match: "git push",
      cwd: "D:\\repo",
    });
    db.deleteAgent(agent.id);
    assert.equal(db.listApprovals(agent.id, 10).length, 0);
    assert.equal(db.listApprovalRules(agent.id).length, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
