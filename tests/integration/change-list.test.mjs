// Tests the turn list used by the changes card and panel.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-change-list-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const db = new AppDatabase(path.join(root, "test.sqlite"));
  const agent = db.createAgent({
    name: "Change list",
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

async function pause() {
  await new Promise((resolve) => setTimeout(resolve, 8));
}

test("lists recorded turns newest first and skips turns with no files", async () => {
  const { workspace, db, agent, store, cleanup } = setup();
  try {
    const olderFile = path.join(workspace, "older.ts");
    write(olderFile, "one\n");
    const older = db.createTurn(agent.id, "chat");
    store.capture(agent.id, older, olderFile, fs.readFileSync(olderFile));
    write(olderFile, "one\ntwo\n");
    store.finalizeTurn(agent.id, older);
    db.finishTurn(older, "success");
    await pause();

    const newerFile = path.join(workspace, "newer.ts");
    const newer = db.createTurn(agent.id, "routine");
    store.capture(agent.id, newer, newerFile, null);
    write(newerFile, "hello\n");
    store.finalizeTurn(agent.id, newer);
    db.finishTurn(newer, "success");
    await pause();

    const empty = db.createTurn(agent.id, "chat");
    db.finishTurn(empty, "success");

    const list = store.list(agent.id);
    assert.equal(list.length, 2);
    assert.equal(list[0].turnId, newer);
    assert.equal(list[1].turnId, older);
    assert.equal(list[0].source, "routine");
    assert.equal(list[0].files.length, 1);
    assert.equal(list[0].files[0].path, "newer.ts");
    assert.equal(list[0].files[0].kind, "create");
    assert.equal(list[1].files[0].path, "older.ts");
    assert.equal(list[1].files[0].additions, 1);
    assert.equal(list[0].files[0].revertible, true);

    assert.equal(store.list(agent.id, 1).length, 1);
    assert.equal(db.listChangeSets(agent.id, 1)[0].turn.id, newer);
  } finally {
    cleanup();
  }
});
