// Checks the read-only image preview used by the workspace explorer.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readWorkspaceImage } = require("../../dist/main/workspace/image-peek.js");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("reads a supported image as a data URL", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-image-peek-"));
  try {
    fs.mkdirSync(path.join(root, "assets"));
    fs.writeFileSync(path.join(root, "assets", "logo.png"), PNG);
    const image = readWorkspaceImage(root, "assets/logo.png");
    assert.equal(image.path, "assets/logo.png");
    assert.equal(image.mime, "image/png");
    assert.equal(image.bytes, PNG.length);
    assert.ok(image.dataUrl.startsWith("data:image/png;base64,"));

    fs.mkdirSync(path.join(root, "deep", "brand"), { recursive: true });
    fs.writeFileSync(path.join(root, "deep", "brand", "mark.png"), PNG);
    const bare = readWorkspaceImage(root, "mark.png");
    assert.equal(bare.path, "deep/brand/mark.png");
    assert.equal(bare.mime, "image/png");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects text, traversal, missing files, and oversized images", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-image-peek-safety-"));
  try {
    fs.writeFileSync(path.join(root, "notes.md"), "hello");
    fs.writeFileSync(path.join(root, "empty.png"), "");
    fs.writeFileSync(path.join(root, "large.png"), Buffer.alloc(10_000_001));
    assert.throws(() => readWorkspaceImage(root, "notes.md"), /not an image/);
    assert.throws(() => readWorkspaceImage(root, "../secret.png"), /outside the workspace/);
    assert.throws(() => readWorkspaceImage(root, "missing.png"), /not found/);
    assert.throws(() => readWorkspaceImage(root, "empty.png"), /empty/);
    assert.throws(() => readWorkspaceImage(root, "large.png"), /too large/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
