import { asRecord, optionalString } from "../args";
import type { AppTool } from "../types";

export const reviewCodeTool: AppTool = {
  name: "review_code",
  description:
    "Review a change with a read-only reviewer. It reads the diff and the code it touches, returns findings, and cannot edit files. Use it when the user asks for a code review or before finishing a risky change. Return the report to the user.",
  parameters: {
    type: "object",
    properties: {
      target: {
        type: "string",
        description:
          "What to review: uncommitted changes (default), staged, a branch, a pull request number, or a path.",
      },
    },
  },
  handler: async (args, ctx) => {
    if (!ctx.workspaceDir) throw new Error("Pick a workspace folder for this agent first");
    if (!ctx.review) throw new Error("Review is unavailable");
    const target = optionalString(asRecord(args), "target") ?? "";
    if (target.length > 500) throw new Error("target is too long");
    return ctx.review(target);
  },
};
