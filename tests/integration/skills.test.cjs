// Tests the skills folder reader against the compiled main process.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadSkillCatalog, skillsForAgent } = require("../../dist/main/skills/index.js");

test("reads installed skills and refreshes when a file changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-files-"));
  try {
    writeSkill(root, "write-lean", "Write lean", "Small diffs.");
    writeSkill(root, "review-change", "Review a change", "Report only.");
    fs.mkdirSync(path.join(root, "Not Skill"));
    fs.writeFileSync(path.join(root, "Not Skill", "SKILL.md"), "---\nname: Nope\ndescription: Nope.\n---\n\nNo.\n");
    fs.mkdirSync(path.join(root, "notes"));

    const first = skillsForAgent(root, ["review-change", "missing", "write-lean"]);
    assert.deepEqual(first.names, ["Review a change", "Write lean"]);
    assert.match(first.prompt, /### Review a change/);
    assert.match(first.prompt, /Report only\./);
    assert.equal(
      loadSkillCatalog(root)
        .map((skill) => skill.id)
        .join(","),
      "review-change,write-lean",
    );

    const file = path.join(root, "write-lean", "SKILL.md");
    fs.writeFileSync(file, "---\nname: Write lean\ndescription: Small diffs.\n---\n\nRead callers.\n");
    const later = Date.now() / 1000 + 5;
    fs.utimesSync(file, later, later);
    const second = skillsForAgent(root, ["write-lean"]);
    assert.match(second.prompt, /### Write lean\nRead callers\./);
    assert.doesNotMatch(second.prompt, /### Write lean\nSmall diffs\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeSkill(root, id, name, body) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${body}\n---\n\n${body}\n`);
}
