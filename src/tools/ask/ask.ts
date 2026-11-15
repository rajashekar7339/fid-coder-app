import { formatQuestionResult, parseAskUserArgs } from "../../shared/question";
import type { AppTool } from "../types";

export const askUserTool: AppTool = {
  name: "ask_user",
  description:
    "Ask the user one question when you need a preference you cannot find in the workspace or the conversation. Pass two to four short choices. The app also offers an Other box and Skip. Do not use this for a fact you can look up, and do not ask again in this turn. If the result says there is no answer, continue and do not ask again.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "One short question" },
      choices: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 4,
        description: "Two to four short choices. The user can also type their own answer.",
      },
    },
    required: ["question", "choices"],
  },
  handler: async (args, ctx) => {
    if (!ctx.askUser) throw new Error("Asking the user is unavailable in this context");
    const draft = parseAskUserArgs(args);
    const outcome = await ctx.askUser(draft);
    if (outcome.source === "aborted") throw new Error("The question closed before an answer.");
    return formatQuestionResult(outcome);
  },
};
