// Tests file_read pagination, binary detection, empty files, and workspace path checks.
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { fileTools } = require("../../dist/tools/files/files.js");

const fileRead = fileTools.find((tool) => tool.name === "file_read");
assert.ok(fileRead);

function context(workspaceDir) {
  return {
    agentId: "agent-1",
    workspaceDir,
    browser: {},
    githubPat: null,
    jiraToken: null,
    jiraSite: null,
  };
}

function write(root, relative, content) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("file_read returns a numbered window", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-read-"));
  const ctx = context(root);
  try {
    write(root, "notes/hello.txt", "desk-note");
    const short = await fileRead.handler({ path: "notes/hello.txt" }, ctx);
    assert.match(short, /Showing lines 1-1 of 1/);
    assert.match(short, /1\|desk-note/);

    write(root, "crlf.txt", "alpha\r\nbeta\r\n");
    const crlf = await fileRead.handler({ path: "crlf.txt" }, ctx);
    assert.match(crlf, /1\|alpha/);
    assert.match(crlf, /2\|beta/);
    assert.match(crlf, /of 2/);

    const many = Array.from({ length: 401 }, (_, index) => `L${index + 1}`).join("\n");
    write(root, "long.txt", many);
    const capped = await fileRead.handler({ path: "long.txt", limit: 10000 }, ctx);
    assert.match(capped, /Showing lines 1-400/);
    assert.match(capped, /More lines follow/);
    assert.match(capped, /400\|L400/);
    assert.doesNotMatch(capped, /401\|L401/);

    const page = await fileRead.handler({ path: "long.txt", offset: 400, limit: 10 }, ctx);
    assert.match(page, /400\|L400/);
    assert.match(page, /401\|L401/);
    assert.match(page, /of 401/);

    write(root, "empty.txt", "");
    assert.equal(await fileRead.handler({ path: "empty.txt" }, ctx), "(empty file)");
    write(root, "binary.bin", Buffer.from([0, 1, 2, 3]));
    await assert.rejects(fileRead.handler({ path: "binary.bin" }, ctx), /binary/);
    await assert.rejects(fileRead.handler({ path: "missing.txt" }, ctx), /not found/i);
    await assert.rejects(fileRead.handler({ path: "../outside.txt" }, ctx), /outside the workspace/);
    await assert.rejects(fileRead.handler({ path: "notes/hello.txt", offset: 0 }, ctx), /offset must be at least 1/);
    await assert.rejects(fileRead.handler({ path: "notes/hello.txt" }, context(null)), /workspace folder/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
