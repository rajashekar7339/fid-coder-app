// Tests skill frontmatter, per-agent selection, and the skills folder reader.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  MAX_SKILL_CHARS,
  composeSkillPrompt,
  normalizeSkillIds,
  parseSkillMarkdown,
  selectSkills,
} from "../../src/shared/skills.ts";

test("parses a skill file and a folded description", () => {
  const single = parseSkillMarkdown("---\nname: Write lean\ndescription: Keep the diff small.\n---\n\nRead the callers.\n");
  assert.deepEqual(single, {
    name: "Write lean",
    description: "Keep the diff small.",
    body: "Read the callers.",
  });
  const folded = parseSkillMarkdown(
    "---\r\nname: Review\r\ndescription: >\r\n  Read the diff\r\n  and the callers.\r\n---\r\n\r\nReport only.\r\n",
  );
  assert.equal(folded?.description, "Read the diff and the callers.");
  assert.equal(folded?.body, "Report only.");
  assert.equal(parseSkillMarkdown("# No frontmatter\n"), null);
  assert.equal(parseSkillMarkdown("---\nname: Only name\n---\n\nBody\n"), null);
});

test("keeps valid skill ids in order and drops the rest", () => {
  const ids = ["review-change", "review-change", "Bad Id", "write-lean", ...Array.from({ length: 10 }, (_, index) => `skill-${index}`)];
  assert.deepEqual(normalizeSkillIds(ids), ["review-change", "write-lean", "skill-0", "skill-1", "skill-2", "skill-3", "skill-4", "skill-5"]);
  assert.deepEqual(normalizeSkillIds("write-lean"), []);
});

test("selects imported skills and skips ones that are not installed", () => {
  const catalog = [
    { id: "write-lean", name: "Write lean" },
    { id: "review-change", name: "Review a change" },
  ];
  assert.deepEqual(
    selectSkills(catalog, ["review-change", "missing", "write-lean"]).map((skill) => skill.id),
    ["review-change", "write-lean"],
  );
});

test("composes the prompt in order and truncates at the cap", () => {
  assert.equal(composeSkillPrompt([]), "");
  const text = composeSkillPrompt([
    { name: "One", body: `${"a".repeat(MAX_SKILL_CHARS)}EXTRA` },
    { name: "Two", body: "b".repeat(MAX_SKILL_CHARS) },
    { name: "Three", body: "should not appear" },
  ]);
  assert.match(text, /^Active skills for this agent\. Follow them on every turn\./);
  assert.match(text, /### One\na+\n…\(truncated\)/);
  assert.doesNotMatch(text, /EXTRA/);
  assert.match(text, /### Two\nb+$/);
  assert.doesNotMatch(text, /Three/);
});

test("shipped skills parse and fit in one prompt", () => {
  const root = path.join(process.cwd(), "skills");
  const chosen = ["write-lean", "review-change"].map((id) => {
    const parsed = parseSkillMarkdown(fs.readFileSync(path.join(root, id, "SKILL.md"), "utf8"));
    assert.ok(parsed, id);
    return { id, ...parsed };
  });
  const prompt = composeSkillPrompt(selectSkills(chosen, ["write-lean", "review-change"]));
  assert.match(prompt, /### Write lean/);
  assert.match(prompt, /### Review a change/);
  assert.match(prompt, /smallest complete change/i);
  assert.match(prompt, /Do not edit/);
  assert.equal(prompt.includes("…(truncated)"), false);
});
