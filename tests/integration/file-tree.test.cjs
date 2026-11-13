// Checks the safe, lazy directory listing used by the workspace explorer.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  MAX_DIRECTORY_ENTRIES,
  listWorkspaceDirectory,
} = require("../../dist/main/workspace/file-tree.js");

function write(root, relative, content = "") {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("lists one directory level, skips build folders, and sorts folders first", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-file-tree-"));
  try {
    write(root, "src/main/a.ts", "a");
    write(root, "src/z.ts", "z");
    write(root, "src/main/nested/b.ts", "b");
    write(root, "README.md", "# Demo");
    write(root, "node_modules/pkg/index.js", "skip");
    write(root, ".git/config", "skip");
    write(root, "dist/out.js", "skip");

    const rootListing = await listWorkspaceDirectory(root);
    assert.equal(rootListing.truncated, false);
    assert.deepEqual(
      rootListing.entries.map((entry) => `${entry.kind}:${entry.path}`),
      ["dir:src", "file:README.md"],
    );

    const srcListing = await listWorkspaceDirectory(root, "src");
    assert.deepEqual(
      srcListing.entries.map((entry) => `${entry.kind}:${entry.path}`),
      ["dir:src/main", "file:src/z.ts"],
    );

    const nestedListing = await listWorkspaceDirectory(root, "src/main/nested");
    assert.deepEqual(nestedListing.entries.map((entry) => entry.path), [
      "src/main/nested/b.ts",
    ]);

    await assert.rejects(listWorkspaceDirectory(root, "../secret"), /outside the workspace/);
    await assert.rejects(listWorkspaceDirectory(root, "README.md"), /not a folder/);
    await assert.rejects(listWorkspaceDirectory(root, "missing"), /not found/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("caps a large folder and reports the cap", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-file-tree-cap-"));
  try {
    const many = path.join(root, "many");
    fs.mkdirSync(many);
    for (let index = 0; index < MAX_DIRECTORY_ENTRIES + 5; index += 1) {
      fs.writeFileSync(path.join(many, `file-${String(index).padStart(4, "0")}.txt`), "");
    }
    const listing = await listWorkspaceDirectory(root, "many");
    assert.equal(listing.entries.length, MAX_DIRECTORY_ENTRIES);
    assert.equal(listing.truncated, true);
    assert.equal(listing.entries[0]?.name, "file-0000.txt");
    assert.equal(
      listing.entries[listing.entries.length - 1]?.name,
      `file-${String(MAX_DIRECTORY_ENTRIES - 1).padStart(4, "0")}.txt`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("does not list symlinks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-file-tree-link-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "fid-file-tree-outside-"));
  try {
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    try {
      fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "linked.txt"));
    } catch (error) {
      if (error.code === "EPERM" || error.code === "EACCES") return;
      throw error;
    }
    const listing = await listWorkspaceDirectory(root);
    assert.equal(listing.entries.some((entry) => entry.name === "linked.txt"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
