import assert from "node:assert/strict";
import test from "node:test";
import { parseSkillMarkdown } from "../../src/shared/skills.ts";
import {
  SKILL_DENIED_TEXT,
  SKILL_SAVE_COMMAND_PROMPT,
  parseSkillDraft,
  skillDraftProblem,
  skillIdFromName,
  skillMarkdown,
  skillSavedText,
} from "../../src/shared/skill-draft.ts";

const draft = {
  name: "Release notes",
  description: "Write notes: today's plan",
  steps: "1. Read the merged pull requests.",
};

test("a skill draft becomes markdown the parser can read", () => {
  const parsed = parseSkillDraft({
    name: "  Release notes  ",
    description: ' Write notes: today\'s "plan" ',
    steps: "\n1. Read the merged pull requests.\n",
  });
  assert.equal(parsed.id, "release-notes");
  assert.equal(parsed.name, "Release notes");
  assert.equal(parsed.description, 'Write notes: today\'s "plan"');
  const text = skillMarkdown(parsed);
  const roundTrip = parseSkillMarkdown(text);
  assert.ok(roundTrip);
  assert.equal(roundTrip.name, parsed.name);
  assert.equal(roundTrip.description, parsed.description);
  assert.equal(roundTrip.body, parsed.steps);
  assert.equal(skillSavedText(parsed.id), "Saved skill release-notes in your skills library. Use /skills release-notes to run it.");
  assert.match(SKILL_DENIED_TEXT, /Do not try again/);
});

test("the save command asks for the whole task", () => {
  assert.match(SKILL_SAVE_COMMAND_PROMPT, /entire conversation/);
  assert.match(SKILL_SAVE_COMMAND_PROMPT, /not only the last exchange/);
  assert.match(SKILL_SAVE_COMMAND_PROMPT, /every step/);
  assert.match(SKILL_SAVE_COMMAND_PROMPT, /file paths/);
  assert.match(SKILL_SAVE_COMMAND_PROMPT, /do not generalize/);
});

test("a skill name needs letters or numbers", () => {  assert.equal(skillIdFromName("C++ helper"), "c-helper");
  assert.throws(() => skillIdFromName("!!!"), /letters or numbers/);
  assert.throws(() => parseSkillDraft({ name: " ", description: "A step.", steps: "Do it." }), /Missing name/);
  assert.throws(() => parseSkillDraft({ name: "Notes", description: " ", steps: "Do it." }), /Missing description/);
  assert.throws(() => parseSkillDraft({ name: "Notes", description: "A step.", steps: "  " }), /Missing steps/);
});

test("secrets and scripts are refused and ordinary steps are kept", () => {
  assert.equal(skillDraftProblem("Read the token from Settings. Run the tests."), null);
  assert.match(skillDraftProblem("token: abcdefghij") ?? "", /secrets/);
  assert.match(skillDraftProblem("ghp_abcdefghijklmnopqrst") ?? "", /secrets/);
  assert.match(skillDraftProblem("password: hunter22") ?? "", /secrets/);
  assert.match(skillDraftProblem("```bash\nnpm test\n```") ?? "", /scripts/);
  assert.match(skillDraftProblem("#!/bin/bash\necho hi") ?? "", /scripts/);
  assert.match(skillDraftProblem("<script>alert(1)</script>") ?? "", /scripts/);
  assert.equal(skillDraftProblem("```text\nRun the tests.\n```"), null);
  assert.throws(
    () => parseSkillDraft({ ...draft, steps: "```powershell\nRemove-Item foo\n```" }),
    /scripts/,
  );
});
