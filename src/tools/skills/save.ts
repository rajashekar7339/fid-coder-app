import {
  SAVE_SKILL_TOOL,
  SKILL_CLOSED_TEXT,
  SKILL_DENIED_TEXT,
  SKILL_TIMEOUT_TEXT,
  parseSkillDraft,
  skillSavedText,
} from "../../shared/skill-draft";
import type { AppTool } from "../types";

export const saveSkillTool: AppTool = {
  name: SAVE_SKILL_TOOL,
  description:
    "Save a reusable skill only when the user asks you to save this procedure. Review the whole task in the conversation, from the first request to the final result, not just the last message. Preserve concrete paths, URLs, commands, and step names. Pass a short name, a one-line description of when to use it, and the steps with any checks. The user confirms and can edit the draft before anything is written. Do not include secrets, tokens, or scripts. If they do not save it, do not try again unless they ask.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short skill name" },
      description: { type: "string", description: "One line describing when to use the skill" },
      steps: {
        type: "string",
        description: "Plain steps. No secrets and no scripts.",
      },
    },
    required: ["name", "description", "steps"],
  },
  handler: async (args, ctx) => {
    const draft = parseSkillDraft(args);
    if (!ctx.saveSkill) throw new Error("Saving a skill is unavailable in this context");
    const outcome = await ctx.saveSkill(draft);
    if (outcome.source === "aborted") throw new Error(SKILL_CLOSED_TEXT);
    if (!outcome.saved) return outcome.source === "timeout" ? SKILL_TIMEOUT_TEXT : SKILL_DENIED_TEXT;
    return skillSavedText(outcome.skillId);
  },
};
