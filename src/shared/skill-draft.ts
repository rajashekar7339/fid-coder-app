export const SAVE_SKILL_TOOL = "save_skill";
export const SKILL_SAVE_TIMEOUT_MS = 2 * 60 * 1000;
export const SKILL_SAVE_MESSAGE_WINDOW = 30;
export const SKILL_SAVE_TRANSCRIPT_CHARS = 20_000;
export const SKILL_NAME_MAX = 80;
export const SKILL_DRAFT_DESCRIPTION_MAX = 400;
export const SKILL_STEPS_MAX = 4_000;

const SKILL_ID = /^[a-z0-9-]{1,64}$/;

export const SKILL_SAVE_HINT =
  "Call save_skill only when the user asks you to save this procedure. Review the whole task in this conversation, from the user's first request to the final result, not just the last message. Preserve concrete paths, URLs, commands, and step names. Pass a short name, a one-line description of when to use it, and the steps with any checks. Do not include secrets or scripts. If they do not save it, do not try again unless they ask.";

export const SKILL_SAVE_COMMAND_PROMPT =
  "/skill-save — Save the task we just completed as a reusable skill. Review the entire conversation above, from the user's first request through the final result, not only the last exchange. Preserve the concrete goal, file paths, URLs, commands, and step names from the conversation; do not generalize them. Capture the inputs, every step that worked in order, how to check the result, and when to ask the user first. Call save_skill once with a short name, a when-to-use description, and the steps as plain text. Do not include secrets or scripts. If the user does not save it, do not try again.";

export const SKILL_DENIED_TEXT = "The user did not save the skill. Do not try again unless they ask.";
export const SKILL_TIMEOUT_TEXT = "The skill was not saved. Do not try again unless the user asks.";
export const SKILL_CLOSED_TEXT = "The skill closed before it was saved.";

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{8,}/,
  /github_pat_[A-Za-z0-9_]{8,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /xox[baprs]-[A-Za-z0-9-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/i,
  /\b(?:password|passwd|api[_-]?key|secret|token)\b\s*[:=]\s*['"]?[A-Za-z0-9+/_.=-]{8,}/i,
];

const SCRIPT_FENCE = /```(?:bash|sh|shell|powershell|pwsh|cmd|bat|js|javascript|ts|typescript|py|python)\b/i;
const SHEBANG = /(^|\n)#!/;
const SCRIPT_TAG = /<script\b/i;

export type SkillDraft = {
  id: string;
  name: string;
  description: string;
  steps: string;
};

export type SkillDraftInput = Pick<SkillDraft, "name" | "description" | "steps">;

export function skillSavedText(id: string): string {
  return `Saved skill ${id} in your skills library. Use /skills ${id} to run it.`;
}

export function skillIdFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!SKILL_ID.test(slug)) throw new Error("Use a name with letters or numbers.");
  return slug;
}

export function skillDraftProblem(text: string): string | null {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
    return "Remove secrets before saving a skill.";
  }
  if (SCRIPT_FENCE.test(text) || SHEBANG.test(text) || SCRIPT_TAG.test(text)) {
    return "Save the steps as text. Do not include scripts.";
  }
  return null;
}

export function parseSkillDraft(args: unknown): SkillDraft {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object");
  }
  const record = args as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) throw new Error("Missing name");
  if (typeof record.description !== "string" || !record.description.trim()) {
    throw new Error("Missing description");
  }
  if (typeof record.steps !== "string" || !record.steps.trim()) throw new Error("Missing steps");
  const name = record.name.trim().replace(/\s+/g, " ");
  const description = record.description.trim().replace(/\s+/g, " ");
  const steps = record.steps.trim();
  if (name.length > SKILL_NAME_MAX) throw new Error("Name is too long");
  if (description.length > SKILL_DRAFT_DESCRIPTION_MAX) throw new Error("Description is too long");
  if (steps.length > SKILL_STEPS_MAX) throw new Error("Steps are too long");
  const problem = skillDraftProblem(`${name}\n${description}\n${steps}`);
  if (problem) throw new Error(problem);
  return { id: skillIdFromName(name), name, description, steps };
}

function folded(key: string, value: string): string {
  return `${key}: >\n  ${value.replace(/\s+/g, " ").trim()}`;
}

export function skillMarkdown(draft: Pick<SkillDraft, "name" | "description" | "steps">): string {
  return `---\n${folded("name", draft.name)}\n${folded("description", draft.description)}\n---\n\n${draft.steps.trim()}\n`;
}
