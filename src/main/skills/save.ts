import fs from "fs";
import path from "path";
import { skillMarkdown, type SkillDraft } from "../../shared/skill-draft";
import { isSkillId, parseSkillMarkdown } from "../../shared/skills";
import { skillsDir, userSkillsDir } from "../paths";

const MAX_SKILL_FILE_BYTES = 64_000;

export function prepareSkillSave(draft: SkillDraft): { replaces: boolean } {
  if (!isSkillId(draft.id)) throw new Error("Use a name with letters or numbers.");
  if (fs.existsSync(path.join(skillsDir(), draft.id, "SKILL.md"))) {
    throw new Error("That name matches a built-in skill. Choose another name.");
  }
  return { replaces: fs.existsSync(path.join(userSkillsDir(), draft.id, "SKILL.md")) };
}

export function writeSkillFile(draft: SkillDraft): void {
  prepareSkillSave(draft);
  const markdown = skillMarkdown(draft);
  if (Buffer.byteLength(markdown) > MAX_SKILL_FILE_BYTES) throw new Error("That skill is too long.");
  if (!parseSkillMarkdown(markdown)) throw new Error("That skill could not be saved.");
  const dir = path.join(userSkillsDir(), draft.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), markdown, "utf8");
}
