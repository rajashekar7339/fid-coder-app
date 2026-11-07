import fs from "fs";
import path from "path";
import { MAX_SKILL_CHARS, skillVersionLabel } from "../../shared/skills";
import { asRecord, requiredString } from "../args";
import { lineWindow, readTextWindow } from "../files/files";
import type { AppTool, SkillActivation } from "../types";

const DEFAULT_READ_LINES = 200;
const MAX_READ_LINES = 400;

export const useSkillTool: AppTool = {
  name: "use_skill",
  description:
    "Load the instructions of a skill the user used earlier in this conversation. Call it only when the current message needs that skill. Use the id from the used-skills list in the system message.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Skill id or name from the used-skills list" },
    },
    required: ["id"],
  },
  handler: async (args, ctx) => {
    const record = asRecord(args);
    const id = requiredString(record, "id");
    const skill = findSkill(ctx.skills, id);
    if (!skill) throw new Error(`Skill "${id}" is not available in this conversation.`);
    return skillLoadText(skill);
  },
};

export const skillFileTool: AppTool = {
  name: "skill_read",
  description:
    "Read a supporting file bundled with a skill. Use a path listed in the skill instructions. On a direct /skills turn, omit skill. On a later message, pass the skill id. Returns numbered lines from a text file inside that skill's folder.",
  parameters: {
    type: "object",
    properties: {
      skill: {
        type: "string",
        description: "Skill id or name when reading a file outside a direct /skills turn",
      },
      path: {
        type: "string",
        description: "File path relative to the skill folder, such as references/checklist.md",
      },
      offset: { type: "number", description: "1-based line to start at. Default 1." },
      limit: {
        type: "number",
        description: "How many lines to return. Default 200, maximum 400.",
      },
    },
    required: ["path"],
  },
  handler: async (args, ctx) => {
    const record = asRecord(args);
    const requested = typeof record.skill === "string" ? record.skill.trim() : "";
    let dir = ctx.skillDir;
    if (requested) {
      const skill = findSkill(ctx.skills, requested);
      if (!skill) throw new Error(`Skill "${requested}" is not available in this conversation.`);
      dir = skill.dir;
    }
    if (!dir) throw new Error("No skill is active for this message.");
    const file = resolveSkillFile(dir, requiredString(record, "path"));
    const window = lineWindow(record, DEFAULT_READ_LINES, MAX_READ_LINES);
    return readTextWindow(file, window.offset, window.limit, "skill_read");
  },
};

function findSkill(skills: SkillActivation[] | undefined, wanted: string): SkillActivation | undefined {
  const value = wanted.trim().toLowerCase();
  return skills?.find(
    (skill) =>
      skill.id.toLowerCase() === value || skill.name.trim().toLowerCase() === value,
  );
}

function skillLoadText(skill: SkillActivation): string {
  const raw = skill.body.trim();
  const truncated = raw.length > MAX_SKILL_CHARS;
  const body = truncated ? `${raw.slice(0, MAX_SKILL_CHARS)}\n…(truncated)` : raw;
  const parts = [
    `Skill: ${skill.name} (${skill.id}) · ${skillVersionLabel(skill.version)}`,
    "Follow these instructions for this message.",
    body,
  ];
  if (skill.files.length > 0) {
    const shown = skill.files.slice(0, 40);
    parts.push(
      [
        `Supporting files (read with skill_read, passing skill="${skill.id}"):`,
        ...shown.map((file) => `- ${file.path}`),
        skill.files.length > shown.length ? `- …and ${skill.files.length - shown.length} more` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return parts.join("\n\n");
}

function resolveSkillFile(root: string, requested: string): string {
  let base: string;
  try {
    base = fs.realpathSync(root);
  } catch {
    throw new Error("The skill folder is no longer available.");
  }
  const target = path.resolve(base, requested);
  if (!inside(base, target)) throw new Error("Path is outside the skill folder.");
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    throw new Error("Path was not found.");
  }
  if (!inside(base, real)) throw new Error("Path is outside the skill folder.");
  if (!fs.statSync(real).isFile()) throw new Error("Path is not a file.");
  return real;
}

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
