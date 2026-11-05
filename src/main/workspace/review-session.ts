import { closeLiveSession, openSession, readAssistantText } from "../copilot";
import { readSkill, skillRoots } from "../skills";
import { reviewTools } from "../../tools/registry";
import type { AppTool, ToolContext } from "../../tools/types";

const REVIEW_CALLS = 12;
const REVIEW_TIMEOUT_MS = 120_000;

const FALLBACK = `Review the change like the person who will be paged when it breaks. Order of importance: correct, safe, holds under the expected load, tested, fast, lean. Read the diff and the code it touches. Report findings in Must fix, Should fix, and Nice to have. Each finding has a title with path:line, then What this is, Problem, Fix, and If we skip it. End with a verdict. Do not edit files.`;

export async function runCodeReview(parent: ToolContext, target: string): Promise<string> {
  if (!parent.workspaceDir) throw new Error("Pick a workspace folder for this agent first");
  const skill = readSkill(skillRoots(parent.workspaceDir), "review-change");
  let calls = 0;
  const tools: AppTool[] = reviewTools().map((tool) => ({
    ...tool,
    handler: async (args, ctx) => {
      calls += 1;
      if (calls > REVIEW_CALLS) {
        throw new Error("Review budget is used. Write the report from the files and lines you already have.");
      }
      return tool.handler(args, ctx);
    },
  }));
  const live = await openSession({
    model: parent.model || "auto",
    systemMessage: [
      "You review a code change and return a report. You cannot edit files, run commands, or change git.",
      `Workspace folder: ${parent.workspaceDir}`,
      skill?.body ?? FALLBACK,
      "Use git_status, git_diff, and git_log for the change. Use file_read, read_many, search_text, list_dir, and glob_files for the code it touches. Cite path:line.",
      `Stop when the report is ready. You have at most ${REVIEW_CALLS} tool calls.`,
    ].join("\n\n"),
    tools,
    getContext: () => ({ ...parent, explore: undefined, review: undefined }),
    onToolStart: () => undefined,
    onToolEnd: () => undefined,
  });
  try {
    const prompt = target.trim()
      ? `Review ${target.trim()}.`
      : "Review the uncommitted changes. If the work tree is clean, review the last commit.";
    const response = await live.session.sendAndWait({ prompt }, REVIEW_TIMEOUT_MS);
    const text = readAssistantText(response, "").trim();
    return text || "The reviewer returned no report.";
  } finally {
    await closeLiveSession(live);
  }
}
