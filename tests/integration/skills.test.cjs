// Tests the skills folder reader against the compiled main process.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// previewContext reads the settings/tools flags through the secret store.
// The test has no Electron app, so stub the read-only checks before loading
// the runner.
const secrets = require("../../dist/main/secrets.js");
secrets.hasSecret = () => false;
secrets.getSecret = () => null;

const { listSkillInfo, loadSkillCatalog, readSkill, skillsForAgent } = require("../../dist/main/skills/index.js");
const { AppDatabase } = require("../../dist/main/db/index.js");
const { Runner } = require("../../dist/main/chat/runner.js");

test("reads installed skills and refreshes when a file changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-files-"));
  try {
    writeSkill(root, "write-lean", "Write lean", "Small diffs.");
    writeSkill(root, "review-change", "Review a change", "Report only.");
    fs.mkdirSync(path.join(root, "Not Skill"));
    fs.writeFileSync(path.join(root, "Not Skill", "SKILL.md"), "---\nname: Nope\ndescription: Nope.\n---\n\nNo.\n");
    fs.mkdirSync(path.join(root, "notes"));

    const roots = [{ root, source: "builtin" }];
    const first = skillsForAgent(roots, ["review-change", "missing", "write-lean"]);
    assert.deepEqual(first.names, ["Review a change", "Write lean"]);
    assert.match(first.prompt, /### Review a change/);
    assert.match(first.prompt, /Report only\./);
    assert.equal(
      loadSkillCatalog(roots)
        .map((skill) => skill.id)
        .join(","),
      "review-change,write-lean",
    );

    const file = path.join(root, "write-lean", "SKILL.md");
    fs.writeFileSync(file, "---\nname: Write lean\ndescription: Small diffs.\n---\n\nRead callers.\n");
    const later = Date.now() / 1000 + 5;
    fs.utimesSync(file, later, later);
    const second = skillsForAgent(roots, ["write-lean"]);
    assert.match(second.prompt, /### Write lean\nRead callers\./);
    assert.doesNotMatch(second.prompt, /### Write lean\nSmall diffs\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a selected skill reaches only that agent's system message", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-agents-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const withSkill = db.createAgent({
      name: "Lean coder",
      systemPrompt: "Write code.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
      memoryEnabled: false,
      skillIds: ["write-lean"],
    });
    const withoutSkill = db.createAgent({
      name: "Plain coder",
      systemPrompt: "Write code.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
      memoryEnabled: false,
      skillIds: [],
    });

    const runner = new Runner(db, {}, {});
    const lean = await runner.previewContext(withSkill.id);
    const plain = await runner.previewContext(withoutSkill.id);

    assert.deepEqual(lean.skillNames, ["Write lean"]);
    assert.match(lean.systemMessage, /smallest complete change/i);
    assert.deepEqual(plain.skillNames, []);
    assert.doesNotMatch(plain.systemMessage, /smallest complete change/i);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reports a malformed skill and reads a selected skill body", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-info-"));
  try {
    writeSkill(root, "write-lean", "Write lean", "Small diffs.");
    const broken = path.join(root, "broken");
    fs.mkdirSync(broken);
    fs.writeFileSync(path.join(broken, "SKILL.md"), "---\nname: Broken\n---\n\nBody\n");

    const roots = [{ root, source: "builtin" }];
    const catalog = listSkillInfo(roots);
    assert.deepEqual(catalog.skills.map((skill) => skill.id), ["write-lean"]);
    assert.equal(catalog.skills[0].chars > 0, true);
    assert.match(catalog.warnings.join("\n"), /broken/);

    const content = readSkill(roots, "write-lean", "builtin");
    assert.equal(content.id, "write-lean");
    assert.match(content.body, /Small diffs/);
    assert.equal(content.path.endsWith(path.join("write-lean", "SKILL.md")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeSkill(root, id, name, body) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`);
}
