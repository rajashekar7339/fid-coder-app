// Tests the generic path tree used by the workspace explorer.

import assert from "node:assert/strict";
import test from "node:test";
import {
  ancestorDirectories,
  buildPathTree,
  normalizeWorkspacePath,
} from "../../src/shared/file-tree.ts";

test("normalizes workspace paths", () => {
  assert.equal(normalizeWorkspacePath("./src\\main\\a.ts"), "src/main/a.ts");
  assert.equal(normalizeWorkspacePath("src//main/a.ts"), "src/main/a.ts");
  assert.equal(normalizeWorkspacePath("/src/main/a.ts/"), "src/main/a.ts");
  assert.equal(normalizeWorkspacePath(""), "");
});

test("groups paths into folders and sorts folders before files", () => {
  const tree = buildPathTree([
    "src/main/b.ts",
    "src/main/a.ts",
    "README.md",
    "src/main/nested/c.ts",
    "src/z.ts",
  ]);
  assert.deepEqual(
    tree.map((node) => `${node.kind}:${node.name}`),
    ["folder:src", "file:README.md"],
  );
  const src = tree[0];
  if (!src || src.kind !== "folder") throw new Error("expected src folder");
  assert.deepEqual(
    src.children.map((node) => `${node.kind}:${node.name}`),
    ["folder:main", "file:z.ts"],
  );
  const main = src.children[0];
  if (!main || main.kind !== "folder") throw new Error("expected main folder");
  assert.deepEqual(
    main.children.map((node) => `${node.kind}:${node.name}`),
    ["folder:nested", "file:a.ts", "file:b.ts"],
  );
  const nested = main.children[0];
  if (!nested || nested.kind !== "folder") throw new Error("expected nested folder");
  assert.deepEqual(nested.children.map((node) => node.path), ["src/main/nested/c.ts"]);
});

test("deduplicates paths and keeps nested file paths", () => {
  const tree = buildPathTree(["./src/a.ts", "src\\a.ts", "src/a.ts"]);
  const src = tree[0];
  if (!src || src.kind !== "folder") throw new Error("expected src folder");
  assert.equal(src.children.length, 1);
  assert.equal(src.children[0]?.path, "src/a.ts");
});

test("returns the ancestor folders of a path", () => {
  assert.deepEqual(ancestorDirectories("src/main/a.ts"), ["src", "src/main"]);
  assert.deepEqual(ancestorDirectories("./src\\main\\nested\\a.ts"), [
    "src",
    "src/main",
    "src/main/nested",
  ]);
  assert.deepEqual(ancestorDirectories("README.md"), []);
  assert.deepEqual(ancestorDirectories(""), []);
});
