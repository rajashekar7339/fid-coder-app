// Tests attachment validation, Copilot attachment shapes, and message persistence.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { AppDatabase } = require("../../dist/main/db/index.js");
const {
  buildCopilotAttachments,
  describeAttachmentFiles,
} = require("../../dist/main/workspace/attachments.js");

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lv0nYQAAAABJRU5ErkJggg==",
  "base64",
);

function workspaceFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-attachments-"));
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "src", "demo.ts"),
    ["line 1", "line 2", "line 3", "line 4", "line 5"].join("\n"),
    "utf8",
  );
  fs.writeFileSync(path.join(workspace, "README.md"), "# Demo\n", "utf8");
  return { root, workspace };
}

function agentFor(workspace) {
  return {
    id: "agent-1",
    name: "Attachments",
    description: "",
    systemPrompt: "Review.",
    workspaceDir: workspace,
    model: "auto",
    toolProfile: "developer",
    readOnly: false,
    memorySummary: "",
    memoryEnabled: false,
    lastActivityAt: null,
    nextRoutineAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("builds a selection attachment with exact text and zero-based lines", () => {
  const { root, workspace } = workspaceFixture();
  try {
    const built = buildCopilotAttachments(agentFor(workspace), [
      {
        kind: "selection",
        path: "src/demo.ts",
        name: "demo.ts",
        startLine: 2,
        endLine: 3,
      },
    ]);
    const sdk = built.sdk[0];
    assert.equal(sdk.type, "selection");
    assert.equal(sdk.filePath, path.join(workspace, "src", "demo.ts"));
    assert.equal(sdk.displayName, "demo.ts:2–3");
    assert.equal(sdk.text, "line 2\nline 3");
    assert.deepEqual(sdk.selection.start, { line: 1, character: 0 });
    assert.deepEqual(sdk.selection.end, { line: 2, character: "line 3".length });
    assert.equal(built.stored[0].startLine, 2);
    assert.equal(built.stored[0].endLine, 3);
    assert.match(built.prompt, /- demo\.ts:2–3 \(selected lines\)/);

    const clamped = buildCopilotAttachments(agentFor(workspace), [
      { kind: "selection", path: "src/demo.ts", name: "demo.ts", startLine: 4, endLine: 99 },
    ]);
    assert.equal(clamped.sdk[0].text, "line 4\nline 5");
    assert.equal(clamped.stored[0].endLine, 5);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("passes text and code files as workspace paths", () => {
  const { root, workspace } = workspaceFixture();
  try {
    const workspaceFile = buildCopilotAttachments(agentFor(workspace), [
      { kind: "workspace", path: "README.md", name: "README.md" },
    ]);
    assert.equal(workspaceFile.sdk.length, 0);
    assert.match(workspaceFile.prompt, /- README\.md \(workspace file\)/);

    const bareName = buildCopilotAttachments(agentFor(workspace), [
      { kind: "workspace", path: "demo.ts", name: "demo.ts" },
    ]);
    assert.equal(bareName.sdk.length, 0);
    assert.equal(bareName.stored[0].path, "src/demo.ts");
    assert.match(bareName.prompt, /- src\/demo\.ts \(workspace file\)/);

    const upload = path.join(root, "notes.csv");
    fs.writeFileSync(upload, "name,value\nalpha,1\n", "utf8");
    const local = buildCopilotAttachments(agentFor(workspace), [
      { kind: "upload", path: upload, name: "notes.csv" },
    ]);
    assert.equal(local.sdk.length, 0);
    assert.equal(local.stored[0].kind, "upload");
    assert.match(local.stored[0].path, /^\.fid\/uploads\/[^/]+\/notes\.csv$/);
    assert.match(local.prompt, /- \.fid\/uploads\/[^/]+\/notes\.csv \(uploaded file\)/);
    assert.equal(
      fs.readFileSync(path.join(workspace, ...local.stored[0].path.split("/")), "utf8"),
      "name,value\nalpha,1\n",
    );
    assert.equal(
      fs.readFileSync(path.join(workspace, ".fid", "uploads", ".gitignore"), "utf8"),
      "*\n",
    );

    const binary = path.join(root, "data.bin");
    fs.writeFileSync(binary, Buffer.from([0x61, 0x00, 0x62]));
    const binaryUpload = buildCopilotAttachments(agentFor(workspace), [
      { kind: "upload", path: binary, name: "data.bin" },
    ]);
    assert.equal(binaryUpload.sdk.length, 0);
    assert.match(binaryUpload.stored[0].path, /^\.fid\/uploads\/[^/]+\/data\.bin$/);

    const large = path.join(root, "large.txt");
    fs.writeFileSync(large, Buffer.alloc(3 * 1024 * 1024, 0x61));
    const largeUpload = buildCopilotAttachments(agentFor(workspace), [
      { kind: "upload", path: large, name: "large.txt" },
    ]);
    assert.equal(largeUpload.sdk.length, 0);
    assert.match(largeUpload.stored[0].path, /^\.fid\/uploads\/[^/]+\/large\.txt$/);

    const imagePath = path.join(root, "pixel.png");
    fs.writeFileSync(imagePath, PNG);
    const image = buildCopilotAttachments(agentFor(workspace), [
      { kind: "upload", path: imagePath, name: "pixel.png" },
    ]);
    assert.equal(image.sdk[0].type, "blob");
    assert.equal(image.sdk[0].mimeType, "image/png");
    assert.match(image.prompt, /- pixel\.png \(image attachment\)/);
    assert.equal(Buffer.from(image.sdk[0].data, "base64").length, PNG.length);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("copies CSV and Excel uploads as workspace paths", () => {
  const { root, workspace } = workspaceFixture();
  try {
    const csv = path.join(root, "rows.csv");
    const xlsx = path.join(root, "book.xlsx");
    fs.writeFileSync(csv, "name,value\nalpha,1\n", "utf8");
    fs.writeFileSync(xlsx, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const built = buildCopilotAttachments(agentFor(workspace), [
      { kind: "upload", path: csv, name: "rows.csv" },
      { kind: "upload", path: xlsx, name: "book.xlsx" },
    ]);
    assert.equal(built.sdk.length, 0);
    assert.match(built.stored[0].path, /^\.fid\/uploads\/[^/]+\/rows\.csv$/);
    assert.match(built.stored[1].path, /^\.fid\/uploads\/[^/]+\/book\.xlsx$/);
    assert.match(built.prompt, /rows\.csv \(uploaded file\)/);
    assert.match(built.prompt, /book\.xlsx \(uploaded file\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("attaches a text upload directly when the agent has no workspace", () => {
  const { root, workspace } = workspaceFixture();
  try {
    const upload = path.join(root, "notes.csv");
    fs.writeFileSync(upload, "name,value\nalpha,1\n", "utf8");
    const noWorkspace = { ...agentFor(null), workspaceDir: null };
    const built = buildCopilotAttachments(noWorkspace, [
      { kind: "upload", path: upload, name: "notes.csv" },
    ]);
    assert.equal(built.sdk.length, 1);
    const sdk = built.sdk[0];
    assert.equal(sdk.type, "selection");
    assert.equal(sdk.filePath, upload);
    assert.equal(sdk.displayName, "notes.csv");
    assert.equal(sdk.text, "name,value\nalpha,1\n");
    assert.deepEqual(sdk.selection.start, { line: 0, character: 0 });
    assert.deepEqual(sdk.selection.end, { line: 1, character: 7 });
    assert.equal(built.stored[0].path, upload);
    assert.match(built.prompt, /notes\.csv \(attached text/);

    const browser = { ...agentFor(workspace), toolProfile: "browser" };
    const browserBuilt = buildCopilotAttachments(browser, [
      { kind: "upload", path: upload, name: "notes.csv" },
    ]);
    assert.equal(browserBuilt.sdk[0].type, "selection");

    const imagePath = path.join(root, "pixel.png");
    fs.writeFileSync(imagePath, PNG);
    const image = buildCopilotAttachments(noWorkspace, [
      { kind: "upload", path: imagePath, name: "pixel.png" },
    ]);
    assert.equal(image.sdk[0].type, "blob");

    const binary = path.join(root, "data.bin");
    fs.writeFileSync(binary, Buffer.from([0x61, 0x00, 0x62]));
    assert.throws(
      () =>
        buildCopilotAttachments(noWorkspace, [
          { kind: "upload", path: binary, name: "data.bin" },
        ]),
      /needs a workspace folder and file tools/i,
    );

    const large = path.join(root, "large.txt");
    fs.writeFileSync(large, "x".repeat(200_001));
    assert.throws(
      () =>
        buildCopilotAttachments(noWorkspace, [
          { kind: "upload", path: large, name: "large.txt" },
        ]),
      /too large/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects outside paths and oversized selections", () => {
  const { root, workspace } = workspaceFixture();
  try {
    assert.throws(
      () =>
        buildCopilotAttachments(agentFor(workspace), [
          { kind: "selection", path: "../outside.ts", name: "outside.ts", startLine: 1 },
        ]),
      /outside the workspace/i,
    );

    const long = path.join(workspace, "src", "long.ts");
    fs.writeFileSync(long, Array.from({ length: 500 }, (_, index) => `line ${index + 1}`).join("\n"));
    const longSelection = buildCopilotAttachments(agentFor(workspace), [
      { kind: "selection", path: "src/long.ts", name: "long.ts", startLine: 1, endLine: 500 },
    ]);
    assert.match(longSelection.sdk[0].text, /^line 1\n/);
    assert.match(longSelection.sdk[0].text, /line 500$/);

    const huge = path.join(workspace, "src", "huge.ts");
    fs.writeFileSync(huge, "x".repeat(200_001));
    assert.throws(
      () =>
        buildCopilotAttachments(agentFor(workspace), [
          { kind: "selection", path: "src/huge.ts", name: "huge.ts", startLine: 1 },
        ]),
      /too large/i,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("describes picked files and reports missing ones", () => {
  const { root, workspace } = workspaceFixture();
  try {
    const text = path.join(root, "notes.txt");
    const image = path.join(root, "pixel.png");
    const binary = path.join(root, "binary.txt");
    const bitmap = path.join(root, "pixel.bmp");
    const missing = path.join(root, "missing.txt");
    fs.writeFileSync(text, "hello", "utf8");
    fs.writeFileSync(image, PNG);
    fs.writeFileSync(binary, Buffer.from([0x00, 0x01]));
    fs.writeFileSync(bitmap, PNG);

    const picked = describeAttachmentFiles([text, image, binary, bitmap, missing]);
    assert.deepEqual(picked.attachments.map((item) => item.name), [
      "notes.txt",
      "pixel.png",
      "binary.txt",
      "pixel.bmp",
    ]);
    assert.equal(picked.attachments[0].kind, "upload");
    assert.equal(picked.errors.length, 1);
    assert.match(picked.errors[0], /not found/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("passes unsupported images as files and uses the file name", () => {
  const { root, workspace } = workspaceFixture();
  try {
    const bitmap = path.join(workspace, "pixel.bmp");
    const upload = path.join(root, "upload.bmp");
    fs.writeFileSync(bitmap, PNG);
    fs.writeFileSync(upload, PNG);

    const workspaceFile = buildCopilotAttachments(agentFor(workspace), [
      { kind: "workspace", path: "pixel.bmp", name: "wrong.bmp" },
    ]);
    assert.equal(workspaceFile.sdk.length, 0);
    assert.equal(workspaceFile.stored[0].name, "pixel.bmp");
    assert.equal(workspaceFile.stored[0].path, "pixel.bmp");
    assert.match(workspaceFile.prompt, /- pixel\.bmp \(workspace file\)/);

    const uploadFile = buildCopilotAttachments(agentFor(workspace), [
      { kind: "upload", path: upload, name: "wrong.bmp" },
    ]);
    assert.equal(uploadFile.sdk.length, 0);
    assert.equal(uploadFile.stored[0].name, "upload.bmp");
    assert.match(uploadFile.stored[0].path, /^\.fid\/uploads\/[^/]+\/upload\.bmp$/);
    assert.match(uploadFile.prompt, /- \.fid\/uploads\/[^/]+\/upload\.bmp \(uploaded file\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stores attachments on the user message and survives a reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-attachment-db-"));
  const file = path.join(dir, "app.sqlite");
  const attachments = [
    { kind: "selection", path: "src/a.ts", name: "a.ts", startLine: 3, endLine: 8 },
    { kind: "upload", path: "C:\\tmp\\notes.txt", name: "notes.txt" },
  ];
  try {
    const db = new AppDatabase(file);
    const agent = db.createAgent({
      name: "Attach",
      systemPrompt: "Review.",
      workspaceDir: null,
      model: "auto",
    });
    db.addMessage(agent.id, "user", "Review this.", null, null, attachments);
    db.close();

    const reopened = new AppDatabase(file);
    try {
      const messages = reopened.listMessages(agent.id);
      assert.deepEqual(messages[0].attachments, attachments);
    } finally {
      reopened.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("adds the attachments column to an older messages table", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-attachment-migrate-"));
  const file = path.join(dir, "app.sqlite");
  try {
    const raw = new DatabaseSync(file);
    raw.exec(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    raw.close();

    const db = new AppDatabase(file);
    try {
      const inspect = new DatabaseSync(file);
      const columns = inspect.prepare("PRAGMA table_info(messages)").all();
      inspect.close();
      assert.ok(columns.some((column) => column.name === "attachments"));
      const agent = db.createAgent({
        name: "Migrated",
        systemPrompt: "Review.",
        workspaceDir: null,
        model: "auto",
      });
      const message = db.addMessage(
        agent.id,
        "user",
        "Review.",
        null,
        null,
        [{ kind: "workspace", path: "README.md", name: "README.md" }],
      );
      assert.equal(message.attachments.length, 1);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
