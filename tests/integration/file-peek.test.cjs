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
    assert.equal(near.lineEnd, null);
    assert.equal(near.totalLines, 220);
    assert.match(near.text, /^line 1\n/);
    assert.equal(near.truncated, true);

    const range = readWorkspaceFile(root, "src/demo.ts", 34, 42);
    assert.equal(range.line, 34);
    assert.equal(range.lineEnd, 42);
    assert.equal(range.startLine, 1);

    const clamped = readWorkspaceFile(root, "src/demo.ts", 34, 999);
    assert.equal(clamped.line, 34);
    assert.equal(clamped.lineEnd, 220);

    const reversed = readWorkspaceFile(root, "src/demo.ts", 42, 34);
    assert.equal(reversed.line, 42);
    assert.equal(reversed.lineEnd, null);

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
    assert.equal(noLine.lineEnd, null);
    assert.equal(noLine.startLine, 1);
    assert.equal(noLine.endLine, 160);

    const page = readWorkspaceFile(root, "src/demo.ts", null, null, 161, 50);
    assert.equal(page.line, null);
    assert.equal(page.lineEnd, null);
    assert.equal(page.startLine, 161);
    assert.equal(page.endLine, 210);
    assert.equal(page.totalLines, 220);
    assert.match(page.text, /^line 161\n/);
    assert.equal(page.truncated, true);

    const lastPage = readWorkspaceFile(root, "src/demo.ts", null, null, 201, 50);
    assert.equal(lastPage.startLine, 201);
    assert.equal(lastPage.endLine, 220);
    assert.equal(lastPage.truncated, true);

    const pastStart = readWorkspaceFile(root, "src/demo.ts", null, null, 999, 50);
    assert.equal(pastStart.startLine, 220);
    assert.equal(pastStart.endLine, 220);

    const clampedStart = readWorkspaceFile(root, "src/demo.ts", null, null, 0, 10);
    assert.equal(clampedStart.startLine, 1);
    assert.equal(clampedStart.endLine, 10);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resolves a bare or partial file name inside the workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-file-peek-name-"));
  try {
    const nested = path.join(root, "src", "main", "java", "Test.java");
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.writeFileSync(nested, ["class Test {", "  void run() {}", "}"].join("\n"));

    const bare = readWorkspaceFile(root, "Test.java", 2);
    assert.equal(bare.path, "src/main/java/Test.java");
    assert.equal(bare.line, 2);
    assert.match(bare.text, /void run/);

    const lowerCase = readWorkspaceFile(root, "test.java", 1);
    assert.equal(lowerCase.path, "src/main/java/Test.java");

    const partial = readWorkspaceFile(root, "main/java/Test.java", 1);
    assert.equal(partial.path, "src/main/java/Test.java");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects an ambiguous bare file name", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-file-peek-ambiguous-"));
  try {
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(path.join(root, "test"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "Test.java"), "one\n");
    fs.writeFileSync(path.join(root, "test", "Test.java"), "two\n");
    assert.throws(
      () => readWorkspaceFile(root, "Test.java", 1),
      (error) =>
        /ambiguous/.test(error.message) &&
        /src\/Test\.java/.test(error.message) &&
        /test\/Test\.java/.test(error.message),
    );
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
    assert.equal(empty.lineEnd, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
