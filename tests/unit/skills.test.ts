// Tests skill frontmatter, invocation matching, filtering, and prompt text.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  MAX_SKILL_CHARS,
  filterSkills,
  matchSkillInvocation,
  parseSkillMarkdown,
  skillTurnPrompt,
  skillVersionLabel,
  usedSkillsPrompt,
} from "../../src/shared/skills.ts";

test("parses a skill file and a folded description", () => {
  const single = parseSkillMarkdown("---\nname: Write lean\ndescription: Keep the diff small.\n---\n\nRead the callers.\n");
  assert.deepEqual(single, {
    name: "Write lean",
    description: "Keep the diff small.",
    version: null,
    body: "Read the callers.",
  });
  const versioned = parseSkillMarkdown("---\nname: Versioned\ndescription: Has a version.\nversion: 2.1.0\n---\n\nBody.\n");
  assert.equal(versioned?.version, "2.1.0");
  const folded = parseSkillMarkdown(
    "---\r\nname: Review\r\ndescription: >\r\n  Read the diff\r\n  and the callers.\r\n---\r\n\r\nReport only.\r\n",
  );
  assert.equal(folded?.description, "Read the diff and the callers.");
  assert.equal(folded?.body, "Report only.");
  const stripped = parseSkillMarkdown("---\nname: Review\ndescription: >-\n  Read the diff.\n---\n\nReport only.\n");
  assert.equal(stripped?.description, "Read the diff.");
  const paragraphs = parseSkillMarkdown(
    "---\nname: Review\ndescription: >\n  Read the diff.\n\n  Report only.\n---\n\nBody\n",
  );
  assert.equal(paragraphs?.description, "Read the diff. Report only.");
  const bom = parseSkillMarkdown("﻿---\nname: Bom\ndescription: Starts with a byte order mark.\n---\n\nBody\n");
  assert.equal(bom?.name, "Bom");
  assert.equal(parseSkillMarkdown("# No frontmatter\n"), null);
  assert.equal(parseSkillMarkdown("---\nname: Only name\n---\n\nBody\n"), null);
});

test("keeps a description up to the spec limit", () => {
  const description = "d".repeat(1_024);
  const parsed = parseSkillMarkdown(`---\nname: Long\ndescription: ${description}\n---\n\nBody\n`);
  assert.equal(parsed?.description, description);
  const over = parseSkillMarkdown(`---\nname: Long\ndescription: ${description}extra\n---\n\nBody\n`);
  assert.equal(over?.description.length, 1_024);
});

test("matches a skill id or display name and leaves the task", () => {
  const catalog = [
    { id: "write", name: "Write" },
    { id: "write-lean", name: "Write lean" },
    { id: "review-change", name: "Review a change" },
  ];
  const byId = matchSkillInvocation(catalog, "write-lean tighten the parser");
  assert.equal("error" in byId ? "" : byId.skill.id, "write-lean");
  assert.equal("error" in byId ? "" : byId.task, "tighten the parser");
  const byName = matchSkillInvocation(catalog, "Write Lean");
  assert.equal("error" in byName ? "" : byName.skill.id, "write-lean");
  assert.equal("error" in byName ? "" : byName.task, "");
  const multiline = matchSkillInvocation(catalog, "Review a change\nlook at the diff");
  assert.equal("error" in multiline ? "" : multiline.skill.id, "review-change");
  assert.equal("error" in multiline ? "" : multiline.task, "look at the diff");
  assert.equal(matchSkillInvocation(catalog, "").error, "Name a skill. Usage: /skills <skill-id> <task>");
  assert.equal(matchSkillInvocation([], "write-lean").error, "No skills are installed.");
  assert.equal(matchSkillInvocation(catalog, "missing").error, 'No skill matches "missing".');
  assert.equal(
    matchSkillInvocation(
      [
        { id: "alpha", name: "Same" },
        { id: "beta", name: "Same" },
      ],
      "Same",
    ).error,
    "More than one skill matches. Use the skill id.",
  );
});

test("labels a missing or present version", () => {
  assert.equal(skillVersionLabel(null), "No version");
  assert.equal(skillVersionLabel(""), "No version");
  assert.equal(skillVersionLabel("1.2.0"), "v1.2.0");
  assert.equal(skillVersionLabel("v2"), "v2");
});

test("filters skills by id, name, or description", () => {
  const catalog = [
    { id: "write-lean", name: "Write lean", description: "Keep the diff small." },
    { id: "review-change", name: "Review a change", description: "Report findings." },
  ];
  assert.deepEqual(filterSkills(catalog, "").map((skill) => skill.id), ["write-lean", "review-change"]);
  assert.deepEqual(filterSkills(catalog, "diff").map((skill) => skill.id), ["write-lean"]);
  assert.deepEqual(filterSkills(catalog, "review").map((skill) => skill.id), ["review-change"]);
  assert.deepEqual(filterSkills(catalog, "review findings").map((skill) => skill.id), ["review-change"]);
  assert.deepEqual(filterSkills(catalog, "write small").map((skill) => skill.id), ["write-lean"]);
  assert.deepEqual(filterSkills(catalog, "write findings").map((skill) => skill.id), []);
  assert.deepEqual(filterSkills(catalog, "nothing"), []);
});

test("builds a one-message skill prompt and truncates the body", () => {
  const prompt = skillTurnPrompt({ name: "Write lean", body: "Read the callers." });
  assert.match(prompt, /^The user invoked this skill for this message\./);
  assert.match(prompt, /### Write lean\nRead the callers\./);
  assert.doesNotMatch(prompt, /User request:/);
  const cut = skillTurnPrompt({ name: "Long", body: `${"a".repeat(MAX_SKILL_CHARS)}EXTRA` });
  assert.match(cut, /a+\n…\(truncated\)/);
  assert.doesNotMatch(cut, /EXTRA/);
  const withFiles = skillTurnPrompt({ name: "Review", body: "Read the checklist." }, [
    { path: "references/checklist.md", bytes: 120 },
    { path: "scripts/check.py", bytes: 300 },
  ]);
  assert.match(withFiles, /Supporting files/);
  assert.match(withFiles, /- references\/checklist\.md/);
  assert.match(withFiles, /- scripts\/check\.py/);
  assert.doesNotMatch(skillTurnPrompt({ name: "Review", body: "Read." }), /Supporting files/);
});

test("builds a compact used-skills list", () => {
  const prompt = usedSkillsPrompt([
    { id: "review-change", name: "Review a change", description: "Review a diff for bugs." },
    { id: "long", name: "Long", description: "d".repeat(200) },
  ]);
  assert.match(prompt, /Skills used earlier in this conversation/);
  assert.ok(prompt.includes("- review-change (Review a change): Review a diff for bugs."));
  assert.ok(prompt.includes(`- long (Long): ${"d".repeat(160)}…`));
  assert.match(prompt, /only if the current message needs that skill/);
});

test("shipped skills parse and fit in one prompt", () => {
  const root = path.join(process.cwd(), "skills");
  for (const id of ["write-lean", "review-change"]) {
    const parsed = parseSkillMarkdown(fs.readFileSync(path.join(root, id, "SKILL.md"), "utf8"));
    assert.ok(parsed, id);
    const prompt = skillTurnPrompt(parsed);
    assert.match(prompt, new RegExp(`### ${parsed.name}`));
    assert.equal(prompt.includes("…(truncated)"), false);
  }
});
