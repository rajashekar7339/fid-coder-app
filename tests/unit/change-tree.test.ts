// Tests the folder tree and citation lookup for workspace changes.

import assert from "node:assert/strict";
import test from "node:test";
import { buildChangeTree, filterChangeTree } from "../../src/shared/change-tree.ts";
import { changeTotals, findChangedFile } from "../../src/shared/changes.ts";
import type { ChangeSet, FileChangeSummary } from "../../src/shared/types.ts";

function file(path: string, additions = 1, deletions = 0): FileChangeSummary {
  return {
    id: path,
    path,
    kind: "update",
    additions,
    deletions,
    revertible: true,
    note: null,
  };
}

const files = [
  file("src/main/a.ts", 4, 1),
  file("src/main/b.ts", 2, 2),
  file("tests/a.test.ts", 5, 0),
  file("README.md", 1, 0),
];

test("groups changed files by folder with folders first", () => {
  const tree = buildChangeTree(files);
  assert.deepEqual(
    tree.map((node) => `${node.kind}:${node.name}`),
    ["folder:src", "folder:tests", "file:README.md"],
  );
  const src = tree[0];
  if (!src || src.kind !== "folder") throw new Error("expected src folder");
  const main = src.children[0];
  if (!main || main.kind !== "folder") throw new Error("expected main folder");
  assert.deepEqual(
    main.children.map((node) => node.name),
    ["a.ts", "b.ts"],
  );
});

test("filters by full path and keeps matching parent folders", () => {
  const filtered = filterChangeTree(buildChangeTree(files), "main/a");
  assert.equal(filtered.length, 1);
  const src = filtered[0];
  if (!src || src.kind !== "folder") throw new Error("expected filtered src folder");
  const main = src.children[0];
  if (!main || main.kind !== "folder") throw new Error("expected filtered main folder");
  assert.deepEqual(main.children.map((node) => node.name), ["a.ts"]);
  assert.deepEqual(filterChangeTree(buildChangeTree(files), "zzz"), []);
  assert.deepEqual(filterChangeTree(buildChangeTree(files), "src"), buildChangeTree(files).slice(0, 1));
});

test("sums a change set and finds the newest file match", () => {
  const older: ChangeSet = {
    turnId: "older",
    startedAt: "2026-11-10T10:00:00.000Z",
    source: "chat",
    status: "success",
    files: [file("src/main/a.ts", 2, 1)],
  };
  const newer: ChangeSet = {
    turnId: "newer",
    startedAt: "2026-11-10T11:00:00.000Z",
    source: "chat",
    status: "success",
    files: [file("src/main/a.ts", 4, 1), file("README.md", 1, 0)],
  };
  assert.deepEqual(changeTotals(newer), { additions: 5, deletions: 1 });
  assert.deepEqual(findChangedFile([newer, older], "./src/main/a.ts"), {
    turnId: "newer",
    file: newer.files[0]!,
  });
  assert.equal(findChangedFile([newer, older], "missing.ts"), null);
});
