// Tests approval audit rows and saved allow/deny rules.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
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
      matcher: "exact",
      cwd: "D:\\repo",
    });
    assert.equal(allow.match, "git push origin main");

    const deny = db.createApprovalRule({
      agentId: agent.id,
      kind: "shell",
      decision: "deny",
      match: "git push origin main",
      matcher: "exact",
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
      matcher: "exact",
      cwd: "D:\\repo",
    });
    assert.ok(db.findApprovalRule(agent.id, "shell", "npm test", "D:\\repo"));
    assert.equal(db.findApprovalRule(agent.id, "shell", "npm test", "D:\\other"), null);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("global and prefix rules can be listed, edited, and deleted", () => {
  const { dir, db } = database();
  try {
    const agent = db.createAgent({
      name: "Shell Agent",
      systemPrompt: "Run commands.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
    });
    const other = db.createAgent({
      name: "Other Agent",
      systemPrompt: "Run commands.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
    });
    const global = db.createApprovalRule({
      agentId: null,
      kind: "shell",
      decision: "allow",
      match: "git status",
      matcher: "prefix",
      cwd: "",
    });
    assert.equal(global.agentId, null);
    assert.equal(global.agentName, "All agents");
    assert.equal(global.matcher, "prefix");
    assert.equal(db.findApprovalRule(agent.id, "shell", "git status --short", "D:\\repo")?.id, global.id);
    assert.equal(db.findApprovalRule(other.id, "shell", "git status --short", "D:\\repo")?.id, global.id);
    assert.equal(db.findApprovalRule(agent.id, "shell", "git statusx", "D:\\repo"), null);

    const local = db.createApprovalRule({
      agentId: agent.id,
      kind: "shell",
      decision: "deny",
      match: "git status",
      matcher: "prefix",
      cwd: "",
    });
    assert.equal(db.findApprovalRule(agent.id, "shell", "git status --short", "D:\\repo")?.decision, "deny");
    assert.equal(db.findApprovalRule(other.id, "shell", "git status --short", "D:\\repo")?.decision, "allow");

    const updated = db.updateApprovalRule(local.id, {
      agentId: null,
      kind: "shell",
      decision: "allow",
      match: "git status",
      matcher: "exact",
      cwd: "D:\\repo",
    });
    assert.equal(updated.agentId, null);
    assert.equal(updated.agentName, "All agents");
    assert.equal(updated.matcher, "exact");
    assert.equal(updated.cwd, "D:\\repo");

    const listed = db.listApprovalRules();
    assert.ok(listed.some((rule) => rule.id === global.id && rule.agentId === null && rule.matcher === "prefix"));
    assert.ok(listed.some((rule) => rule.id === local.id && rule.agentId === null && rule.matcher === "exact"));

    db.deleteApprovalRule(local.id);
    assert.equal(db.getApprovalRule(local.id), null);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an older exact-only rules table gains matcher and global scope", () => {
  const { dir, db } = database();
  const file = path.join(dir, "app.sqlite");
  const agent = db.createAgent({
    name: "Shell Agent",
    systemPrompt: "Run commands.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "developer",
  });
  const rule = db.createApprovalRule({
    agentId: agent.id,
    kind: "shell",
    decision: "allow",
    match: "npm test",
    matcher: "exact",
    cwd: "D:\\repo",
  });
  db.close();
  let reopened = null;
  try {
    const raw = new DatabaseSync(file);
    raw.exec(`
      DROP TABLE approval_rules;
      CREATE TABLE approval_rules (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        decision TEXT NOT NULL,
        match TEXT NOT NULL,
        cwd TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(agent_id, kind, decision, match, cwd)
      );
    `);
    raw
      .prepare(
        `INSERT INTO approval_rules (id, agent_id, kind, decision, match, cwd, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(rule.id, agent.id, rule.kind, rule.decision, rule.match, rule.cwd, rule.createdAt);
    raw.close();

    reopened = new AppDatabase(file);
    const loaded = reopened.getApprovalRule(rule.id);
    assert.equal(loaded.matcher, "exact");
    assert.equal(loaded.agentId, agent.id);
    assert.equal(loaded.agentName, "Shell Agent");
    assert.equal(reopened.findApprovalRule(agent.id, "shell", "npm test", "D:\\repo")?.id, rule.id);
  } finally {
    reopened?.close();
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
      matcher: "exact",
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
