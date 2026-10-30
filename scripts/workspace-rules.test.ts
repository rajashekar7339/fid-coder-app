import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createAgentsFile, ruleFilePath, workspaceRules } from "../src/main/workspace/workspace-rules.ts";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "fid-rules-"));
}

test("loads root rules files in a stable order", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "# Agents\nUse pnpm.");
    fs.mkdirSync(path.join(dir, ".fid"));
    fs.writeFileSync(path.join(dir, ".fid", "instructions.md"), "Run the tests.");
    const rules = workspaceRules(dir);
    assert.deepEqual(
      rules.files.map((file) => file.path),
      ["AGENTS.md", ".fid/instructions.md"],
    );
    assert.match(rules.text, /Use pnpm/);
    assert.match(rules.text, /Run the tests/);
    assert.equal(rules.files.every((file) => file.truncated === false), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("returns an empty brief when no rules files exist", () => {
  const dir = tempDir();
  try {
    const rules = workspaceRules(dir);
    assert.equal(rules.text, "");
    assert.deepEqual(rules.files, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("truncates large rules files", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "x".repeat(9_000));
    const rules = workspaceRules(dir);
    const [file] = rules.files;
    assert.ok(file);
    assert.equal(file.chars, 8_000);
    assert.equal(file.truncated, true);
    assert.match(rules.text, /\(truncated\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("creates AGENTS.md from the template once", () => {
  const dir = tempDir();
  try {
    const rules = createAgentsFile(dir);
    const file = path.join(dir, "AGENTS.md");
    assert.equal(fs.existsSync(file), true);
    assert.equal(rules.files[0]?.path, "AGENTS.md");
    const first = fs.readFileSync(file, "utf8");
    createAgentsFile(dir);
    assert.equal(fs.readFileSync(file, "utf8"), first);
    assert.match(first, /Workspace instructions/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fills an empty AGENTS.md with the template", () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "");
    const rules = createAgentsFile(dir);
    const content = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    assert.match(content, /Workspace instructions/);
    assert.equal(rules.files[0]?.path, "AGENTS.md");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("only resolves known rule files inside the workspace", () => {
  const dir = tempDir();
  try {
    assert.equal(ruleFilePath(dir, "AGENTS.md"), path.join(dir, "AGENTS.md"));
    assert.equal(ruleFilePath(dir, "../AGENTS.md"), null);
    assert.equal(ruleFilePath(dir, "notes.md"), null);
    assert.equal(ruleFilePath(dir, ".fid/instructions.md"), path.join(dir, ".fid", "instructions.md"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
