import { readAssistantText, closeLiveSession, openSession } from "../copilot";
import { readOnlyTools } from "../../tools/registry";
import type { AppTool, ToolContext } from "../../tools/types";

const EXPLORE_CALLS = 8;
const EXPLORE_TIMEOUT_MS = 90_000;

export async function runCodeExplore(parent: ToolContext, question: string): Promise<string> {
  if (!parent.workspaceDir) throw new Error("Pick a workspace folder for this agent first");
  let calls = 0;
  const tools: AppTool[] = readOnlyTools().map((tool) => ({
    ...tool,
    handler: async (args, ctx) => {
      calls += 1;
      if (calls > EXPLORE_CALLS) {
        throw new Error("Explore budget is used. Answer from the paths and lines you already have.");
      }
      return tool.handler(args, ctx);
    },
  }));
  const live = await openSession({
    model: parent.model || "auto",
    systemMessage: [
      "You explore a code workspace and return a brief the editor can use.",
      `Workspace folder: ${parent.workspaceDir}`,
      "Use list_dir, glob_files, search_text, file_read, and read_many. You cannot edit files or run commands.",
      "Start with one sentence naming the files that matter. Then list path:line notes. Do not dump whole files.",
      `Stop when you can answer. You have at most ${EXPLORE_CALLS} tool calls.`,
    ].join("\n\n"),
    tools,
    getContext: () => ({ ...parent, explore: undefined }),
    onToolStart: () => undefined,
    onToolEnd: () => undefined,
  });
  try {
    const response = await live.session.sendAndWait({ prompt: question }, EXPLORE_TIMEOUT_MS);
    const text = readAssistantText(response, "").trim();
    return text || "The explorer returned no brief.";
  } finally {
    await closeLiveSession(live);
  }
}
