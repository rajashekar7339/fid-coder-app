// Tests the skill import planner and installer against the compiled main process.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { installSkill, planSkillImport } = require("../../dist/main/skills/install.js");

function skillFile(root, folder, name, version = "1.0.0", body = "Read the callers.") {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use this skill.\nversion: ${version}\n---\n\n${body}\n`,
  );
  return dir;
}

test("installs a skill folder and its supporting files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-install-"));
  try {
    const source = skillFile(root, "lean-skill", "Lean skill");
    fs.mkdirSync(path.join(source, "references"));
    fs.writeFileSync(path.join(source, "references", "notes.md"), "Notes.");
    fs.mkdirSync(path.join(source, ".git"));
    fs.writeFileSync(path.join(source, ".git", "config"), "ignored");

    const dest = path.join(root, "installed");
    const plan = planSkillImport(source);
    assert.equal(plan.id, "lean-skill");
    assert.equal(plan.name, "Lean skill");
    assert.equal(plan.version, "1.0.0");
    const installed = installSkill(plan, dest, false);
    assert.deepEqual(installed, {
      id: "lean-skill",
      name: "Lean skill",
      description: "Use this skill.",
      version: "1.0.0",
      source: "app",
      chars: "Read the callers.".length,
    });
    assert.equal(fs.readFileSync(path.join(dest, "lean-skill", "SKILL.md"), "utf8").includes("Read the callers."), true);
    assert.equal(fs.readFileSync(path.join(dest, "lean-skill", "references", "notes.md"), "utf8"), "Notes.");
    assert.equal(fs.existsSync(path.join(dest, "lean-skill", ".git")), false);

    assert.throws(() => installSkill(plan, dest, false), /already installed/);
    fs.writeFileSync(
      path.join(source, "SKILL.md"),
      "---\nname: Lean skill\ndescription: Updated.\nversion: 2.0.0\n---\n\nUpdated body.\n",
    );
    const replaced = installSkill(planSkillImport(source), dest, true);
    assert.equal(replaced.description, "Updated.");
    assert.equal(replaced.version, "2.0.0");
    assert.match(fs.readFileSync(path.join(dest, "lean-skill", "SKILL.md"), "utf8"), /Updated body/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects folders without a valid SKILL.md", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-bad-"));
  try {
    const empty = path.join(root, "empty");
    fs.mkdirSync(empty);
    assert.match(planSkillImport(empty).error, /no SKILL\.md/);
    const missingDescription = path.join(root, "bad");
    fs.mkdirSync(missingDescription);
    fs.writeFileSync(path.join(missingDescription, "SKILL.md"), "---\nname: Bad\n---\n\nBody\n");
    assert.match(planSkillImport(missingDescription).error, /name and description/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
