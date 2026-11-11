import fs from "fs";
import path from "path";
import { MAX_SKILL_CHARS, skillVersionLabel } from "../../shared/skills";
import { asRecord, requiredString } from "../args";
import { lineWindow, readTextWindow } from "../files/files";
import type { AppTool, SkillActivation } from "../types";

const DEFAULT_READ_LINES = 200;
const MAX_READ_LINES = 400;
const MAX_LISTED_SKILLS = 40;
const MAX_LISTED_DESCRIPTION = 200;

export const listSkillsTool: AppTool = {
  name: "list_skills",
  description:
    "List installed skills with their ids, names, versions, and descriptions. Call this when the current task looks like a reusable procedure, such as a brief, report, one-pager, review, plan, or workflow, or when you are unsure whether a skill fits. Then load the best match with use_skill. Do not call it for a simple answer or a follow-up the conversation already answers.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  handler: async (_args, ctx) => {
    const skills = ctx.skills ?? [];
    if (skills.length === 0) return "No skills are installed.";
    const shown = skills.slice(0, MAX_LISTED_SKILLS);
    const lines = shown.map((skill) => {
      const description = skill.description.replace(/\s+/g, " ").trim();
      const short =
        description.length > MAX_LISTED_DESCRIPTION
          ? `${description.slice(0, MAX_LISTED_DESCRIPTION)}…`
          : description;
      const version = skill.version ? ` · ${skillVersionLabel(skill.version)}` : "";
      return `- ${skill.id} (${skill.name})${version}: ${short}`;
    });
    if (skills.length > shown.length) {
      lines.push(`- …and ${skills.length - shown.length} more in the Skills library`);
    }
    return lines.join("\n");
  },
};

export const useSkillTool: AppTool = {
  name: "use_skill",
  description:
    "Load the instructions of an installed skill. Use an id from list_skills or the used-skills list. Call it only when the current message needs that skill; do not load one for a simple answer.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string", description: "Skill id or name from list_skills or the used-skills list" },
    },
    required: ["id"],
  },
  handler: async (args, ctx) => {
    const record = asRecord(args);
    const id = requiredString(record, "id");
    const skill = findSkill(ctx.skills, id);
    if (!skill) throw new Error(`Skill "${id}" is not available in this conversation. Call list_skills to see installed skills.`);
    ctx.onSkillUsed?.(skill.id);
    return skillLoadText(skill);
  },
};

export const skillFileTool: AppTool = {
  name: "skill_read",
  description:
    "Read a supporting file bundled with a skill. Use a path listed in the skill instructions. On a direct /skills turn, omit skill. On a later message, pass the skill id from list_skills. Returns numbered lines from a text file inside that skill's folder.",
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
