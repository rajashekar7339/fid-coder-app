// Tests file checkpoints, diff stats, and reverting a file or an entire turn.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import checkpointsModule from "../../dist/main/workspace/checkpoints.js";
import databaseModule from "../../dist/main/db/index.js";

const { CheckpointStore } = checkpointsModule;
const { AppDatabase } = databaseModule;

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-checkpoints-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const db = new AppDatabase(path.join(root, "test.sqlite"));
  const agent = db.createAgent({
    name: "Test agent",
    description: "",
    systemPrompt: "Test",
    workspaceDir: workspace,
    model: "auto",
    toolProfile: "developer",
    memoryEnabled: false,
  });
  const store = new CheckpointStore(db, path.join(root, "checkpoints"));
  return {
    workspace,
    db,
    agent,
    store,
    cleanup() {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

test("captures an edit, reports a diff, and restores the file", () => {
  const { workspace, db, agent, store, cleanup } = setup();
  try {
    const file = path.join(workspace, "app.ts");
    write(file, "one\ntwo\n");
    const turnId = db.createTurn(agent.id, "chat");
    store.capture(agent.id, turnId, file, fs.readFileSync(file));
    write(file, "one\nTWO\nthree\n");
    db.finishTurn(turnId, "ok");
    store.finalizeTurn(agent.id, turnId);

    const changes = store.latest(agent.id);
    assert.ok(changes);
    assert.equal(changes.files.length, 1);
    assert.equal(changes.files[0].path, "app.ts");
    assert.equal(changes.files[0].kind, "update");
    assert.equal(changes.files[0].additions, 2);
    assert.equal(changes.files[0].deletions, 1);

    const diff = store.diff(changes.files[0].id);
    assert.equal(diff.before, "one\ntwo\n");
    assert.equal(diff.after, "one\nTWO\nthree\n");

    store.revert(changes.files[0].id);
    assert.equal(fs.readFileSync(file, "utf8"), "one\ntwo\n");
    assert.equal(store.latest(agent.id), null);
  } finally {
    cleanup();
  }
});

test("reverting a created file removes it", () => {
  const { workspace, db, agent, store, cleanup } = setup();
  try {
    const file = path.join(workspace, "new.ts");
    const turnId = db.createTurn(agent.id, "chat");
    store.capture(agent.id, turnId, file, null);
    write(file, "hello\n");
    store.finalizeTurn(agent.id, turnId);

    const changes = store.latest(agent.id);
    assert.ok(changes);
    assert.equal(changes.files[0].kind, "create");
    store.revert(changes.files[0].id);
    assert.equal(fs.existsSync(file), false);
  } finally {
    cleanup();
  }
});

test("refuses to revert a file that changed after the turn", () => {
  const { workspace, db, agent, store, cleanup } = setup();
  try {
    const file = path.join(workspace, "app.ts");
    write(file, "one\n");
    const turnId = db.createTurn(agent.id, "chat");
    store.capture(agent.id, turnId, file, fs.readFileSync(file));
    write(file, "two\n");
    store.finalizeTurn(agent.id, turnId);
    write(file, "three\n");

    const changes = store.latest(agent.id);
    assert.ok(changes);
    assert.throws(() => store.revert(changes.files[0].id), /changed after this turn/);
    assert.equal(fs.readFileSync(file, "utf8"), "three\n");
  } finally {
    cleanup();
  }
});

test("keeps the first checkpoint when a turn edits a file twice", () => {
  const { workspace, db, agent, store, cleanup } = setup();
  try {
    const file = path.join(workspace, "app.ts");
    write(file, "v1\n");
    const turnId = db.createTurn(agent.id, "chat");
    store.capture(agent.id, turnId, file, fs.readFileSync(file));
    write(file, "v2\n");
    store.capture(agent.id, turnId, file, fs.readFileSync(file));
    write(file, "v3\n");
    store.finalizeTurn(agent.id, turnId);

    const changes = store.latest(agent.id);
    assert.ok(changes);
    assert.equal(changes.files.length, 1);
    store.revert(changes.files[0].id);
    assert.equal(fs.readFileSync(file, "utf8"), "v1\n");
  } finally {
    cleanup();
  }
});

test("revert turn restores updates and removes creations", () => {
  const { workspace, db, agent, store, cleanup } = setup();
  try {
    const edited = path.join(workspace, "edited.ts");
    const created = path.join(workspace, "created.ts");
    write(edited, "old\n");
    const turnId = db.createTurn(agent.id, "chat");
    store.capture(agent.id, turnId, edited, fs.readFileSync(edited));
    write(edited, "new\n");
    store.capture(agent.id, turnId, created, null);
    write(created, "fresh\n");
    store.finalizeTurn(agent.id, turnId);

    const changes = store.latest(agent.id);
    assert.ok(changes);
    assert.equal(changes.files.length, 2);
    store.revertTurn(turnId);
    assert.equal(fs.readFileSync(edited, "utf8"), "old\n");
    assert.equal(fs.existsSync(created), false);
    assert.equal(store.latest(agent.id), null);
  } finally {
    cleanup();
  }
});

test("marks an existing file without a checkpoint as not revertible", () => {
  const { workspace, db, agent, store, cleanup } = setup();
  try {
    const file = path.join(workspace, "large.bin");
    const turnId = db.createTurn(agent.id, "chat");
    store.capture(agent.id, turnId, file, null, true);
    write(file, "replaced\n");
    store.finalizeTurn(agent.id, turnId);

    const changes = store.latest(agent.id);
    assert.ok(changes);
    assert.equal(changes.files[0].kind, "update");
    assert.equal(changes.files[0].revertible, false);
    assert.equal(changes.files[0].additions, 0);
    assert.equal(changes.files[0].deletions, 0);
    assert.throws(() => store.revert(changes.files[0].id), /no saved checkpoint/);
  } finally {
    cleanup();
  }
});

