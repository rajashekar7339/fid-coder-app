// Tests bundled skill files and the read-only skill_read tool against dist.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { listSkillFiles } = require("../../dist/main/skills/index.js");
const { skillFileTool, useSkillTool } = require("../../dist/tools/skills/skills.js");

test("lists supporting files without SKILL.md or ignored folders", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-resources-"));
  try {
    fs.writeFileSync(path.join(root, "SKILL.md"), "---\nname: Review\ndescription: Review.\n---\n\nBody\n");
    fs.mkdirSync(path.join(root, "references"));
    fs.writeFileSync(path.join(root, "references", "checklist.md"), "- Check tests\n- Check load\n");
    fs.mkdirSync(path.join(root, "scripts"));
    fs.writeFileSync(path.join(root, "scripts", "run.py"), "print('ok')\n");
    fs.mkdirSync(path.join(root, "node_modules"));
    fs.writeFileSync(path.join(root, "node_modules", "ignored.js"), "ignored\n");
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "config"), "ignored\n");

    assert.deepEqual(
      listSkillFiles(root).map((file) => file.path),
      ["references/checklist.md", "scripts/run.py"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("skill_read reads only files inside the active skill folder", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-read-"));
  try {
    fs.writeFileSync(path.join(root, "SKILL.md"), "---\nname: Review\ndescription: Review.\n---\n\nBody\n");
    fs.mkdirSync(path.join(root, "references"));
    fs.writeFileSync(path.join(root, "references", "checklist.md"), "- Check tests\n- Check load\n");

    const output = await skillFileTool.handler(
      { path: "references/checklist.md", limit: 1 },
      { skillDir: root },
    );
    assert.match(output, /1\|- Check tests/);
    assert.match(output, /Call skill_read with offset 2/);

    await assert.rejects(
      skillFileTool.handler({ path: "../outside.md" }, { skillDir: root }),
      /outside the skill folder/,
    );
    await assert.rejects(
      skillFileTool.handler({ path: "references/checklist.md" }, {}),
      /No skill is active for this message/,
    );
    await assert.rejects(
      skillFileTool.handler({ path: "missing.md" }, { skillDir: root }),
      /Path was not found/,
    );

    const fromUsed = await skillFileTool.handler(
      { skill: "demo", path: "references/checklist.md" },
      { skills: [{ id: "demo", dir: root }] },
    );
    assert.match(fromUsed, /1\|- Check tests/);
    await assert.rejects(
      skillFileTool.handler({ skill: "missing", path: "references/checklist.md" }, { skills: [] }),
      /not available in this conversation/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("use_skill loads a used skill's body and files", async () => {
  const loaded = await useSkillTool.handler(
    { id: "demo" },
    {
      skills: [
        {
          id: "demo",
          name: "Demo",
          description: "Demo skill.",
          version: "1.0.0",
          body: "Read the checklist.",
          dir: "C:\\skills\\demo",
          files: [{ path: "references/checklist.md", bytes: 20 }],
        },
      ],
    },
  );
  assert.match(loaded, /Skill: Demo \(demo\) · v1\.0\.0/);
  assert.match(loaded, /Read the checklist\./);
  assert.match(loaded, /references\/checklist\.md/);
  assert.match(loaded, /passing skill="demo"/);
  await assert.rejects(
    useSkillTool.handler({ id: "missing" }, { skills: [] }),
    /not available in this conversation/,
  );
});
