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

const {
  listSkillInfo,
  loadSkillCatalog,
  readSkill,
  resolveSkillForTurn,
  skillRoots,
} = require("../../dist/main/skills/index.js");
const { AppDatabase } = require("../../dist/main/db/index.js");
const { Runner } = require("../../dist/main/chat/runner.js");
const { listSkillsTool, useSkillTool } = require("../../dist/tools/skills/skills.js");

test("reads installed skills and refreshes when a file changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-files-"));
  try {
    writeSkill(root, "write-lean", "Write lean", "Small diffs.");
    writeSkill(root, "review-change", "Review a change", "Report only.");
    fs.mkdirSync(path.join(root, "Not Skill"));
    fs.writeFileSync(path.join(root, "Not Skill", "SKILL.md"), "---\nname: Nope\ndescription: Nope.\n---\n\nNo.\n");
    fs.mkdirSync(path.join(root, "notes"));

    const roots = [{ root, source: "builtin" }];
    const first = resolveSkillForTurn(roots, "review-change report the diff");
    assert.equal(first.skill.id, "review-change");
    assert.equal(first.task, "report the diff");
    assert.match(first.skill.body, /Report only\./);
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
    const second = resolveSkillForTurn(roots, "write-lean read the callers");
    assert.match(second.skill.body, /Read callers\./);
    assert.doesNotMatch(second.skill.body, /Small diffs\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("skills are not copied into the system message", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-agents-"));
  const db = new AppDatabase(path.join(dir, "app.sqlite"));
  try {
    const agent = db.createAgent({
      name: "Lean coder",
      systemPrompt: "Write code.",
      workspaceDir: null,
      model: "auto",
      toolProfile: "developer",
      memoryEnabled: false,
    });

    const runner = new Runner(db, {}, {});
    const view = await runner.previewContext(agent.id);
    assert.equal(view.skillNames, undefined);
    assert.doesNotMatch(view.systemMessage, /smallest complete change/i);
    assert.doesNotMatch(view.systemMessage, /The user invoked this skill/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("reports a malformed skill and reads a skill body", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-info-"));
  try {
    writeSkill(root, "write-lean", "Write lean", "Small diffs.");
    const resources = path.join(root, "write-lean", "references");
    fs.mkdirSync(resources, { recursive: true });
    fs.writeFileSync(path.join(resources, "checklist.md"), "- Read the callers.\n");
    fs.mkdirSync(path.join(root, "write-lean", ".git"));
    fs.writeFileSync(path.join(root, "write-lean", ".git", "config"), "ignored\n");
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
    assert.deepEqual(content.files, [{ path: "references/checklist.md", bytes: 20 }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("workspace .skills wins and a named skill is loaded for one message", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-dot-"));
  try {
    writeSkill(path.join(workspace, ".skills"), "local-only", "From dot skills", "Dot body.");
    writeSkill(path.join(workspace, ".github", "skills"), "local-only", "From github", "Github body.");
    const roots = skillRoots(workspace).filter((root) => root.source === "workspace");
    const skill = loadSkillCatalog(roots).find((item) => item.id === "local-only");
    assert.equal(skill.name, "From dot skills");
    assert.match(skill.body, /Dot body/);

    const named = resolveSkillForTurn(roots, "From dot skills tighten the parser");
    assert.equal(named.skill.id, "local-only");
    assert.equal(named.task, "tighten the parser");
    assert.match(named.skill.body, /Dot body/);
    assert.match(resolveSkillForTurn(roots, "missing").error, /No skill matches "missing"/);
    assert.match(
      resolveSkillForTurn(roots, "From dot skills").error,
      /Add the task after the skill name/,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("list_skills exposes the catalog and use_skill marks the skill used", async () => {
  const skills = [
    {
      id: "html-report",
      name: "Make an HTML report",
      description: "Create a styled HTML brief.",
      version: "1.0.0",
      body: "Read the template.",
      dir: path.join(process.cwd(), "skills", "html-report"),
      files: [{ path: "template.html", bytes: 1200 }],
    },
  ];
  const context = { skills };
  const listed = await listSkillsTool.handler({}, context);
  assert.match(
    listed,
    /html-report \(Make an HTML report\) · v1\.0\.0: Create a styled HTML brief\./,
  );

  let used = "";
  const loaded = await useSkillTool.handler(
    { id: "html-report" },
    {
      ...context,
      onSkillUsed: (id) => {
        used = id;
      },
    },
  );
  assert.match(loaded, /Skill: Make an HTML report \(html-report\) · v1\.0\.0/);
  assert.match(loaded, /Read the template\./);
  assert.equal(used, "html-report");
  await assert.rejects(
    () => useSkillTool.handler({ id: "missing" }, context),
    /Call list_skills to see installed skills/,
  );
});

function writeSkill(root, id, name, body) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`);
}
