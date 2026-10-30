import { asRecord, requiredString } from "./args";
import type { AppTool } from "./types";

export const exploreCodeTool: AppTool = {
  name: "explore_code",
  description:
    "Ask a read-only explorer to find code in the workspace. Pass a specific question. It may list, search, and read, then it returns a short brief with paths and line numbers. It cannot edit files or run commands. Use the brief, then edit with apply_patch.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "What to find, including the name or behavior you care about" },
    },
    required: ["question"],
  },
  handler: async (args, ctx) => {
    if (!ctx.workspaceDir) throw new Error("Pick a workspace folder for this agent first");
    if (!ctx.explore) throw new Error("Explore is unavailable");
    const question = requiredString(asRecord(args), "question");
    if (question.length > 2_000) throw new Error("question is too long");
    return ctx.explore(question);
  },
};
