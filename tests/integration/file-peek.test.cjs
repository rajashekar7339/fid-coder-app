// Checks the read-only file preview used by path:line citations.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readWorkspaceFile } = require("../../dist/main/workspace/file-peek.js");

test("reads a window around a citation line and clamps the target", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-file-peek-"));
  try {
    const file = path.join(root, "src", "demo.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Array.from({ length: 220 }, (_, index) => `line ${index + 1}`).join("\n"));

    const near = readWorkspaceFile(root, "src/demo.ts", 2);
    assert.equal(near.path, "src/demo.ts");
    assert.equal(near.startLine, 1);
    assert.equal(near.endLine, 160);
    assert.equal(near.line, 2);
    assert.equal(near.totalLines, 220);
    assert.match(near.text, /^line 1\n/);
    assert.equal(near.truncated, true);

    const middle = readWorkspaceFile(root, "src/demo.ts", 120);
    assert.equal(middle.startLine, 60);
    assert.equal(middle.endLine, 219);
    assert.equal(middle.line, 120);
    assert.match(middle.text, /^line 60\n/);

    const past = readWorkspaceFile(root, "src/demo.ts", 999);
    assert.equal(past.line, 220);
    assert.equal(past.endLine, 220);

    const noLine = readWorkspaceFile(root, "src/demo.ts");
    assert.equal(noLine.line, null);
    assert.equal(noLine.startLine, 1);
    assert.equal(noLine.endLine, 160);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects traversal, missing files, and binary data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-file-peek-safety-"));
  try {
    fs.writeFileSync(path.join(root, "binary.bin"), Buffer.from([1, 0, 2, 3]));
    fs.writeFileSync(path.join(root, "empty.txt"), "");
    assert.throws(() => readWorkspaceFile(root, "../secret.txt", 1), /outside the workspace/);
    assert.throws(() => readWorkspaceFile(root, "missing.txt", 1), /not found/);
    assert.throws(() => readWorkspaceFile(root, "binary.bin", 1), /binary/);
    const empty = readWorkspaceFile(root, "empty.txt", 1);
    assert.equal(empty.totalLines, 0);
    assert.equal(empty.text, "");
    assert.equal(empty.line, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
