import { createHash } from "crypto";
import { closeLiveSession, openSession, readAssistantText } from "../copilot";
import { reviewTools } from "../../tools/registry";
import { runArgv } from "../../tools/process";
import type { AppTool, ToolContext } from "../../tools/types";

const MAP_CALLS = 14;
const MAP_TIMEOUT_MS = 120_000;
const MAP_CHARS = 20_000;
const GIT_TIMEOUT_MS = 5_000;

const MAP_SYSTEM = `You map a codebase for a teammate who has just opened it. You cannot edit files, run commands, or change git.

Return Markdown with these sections:
## Overview
One paragraph: what the system does and the main constraints.
## Entry points
Where execution starts, with path:line.
## Components
A table with Component, Responsibility, Key files, and Depends on. Use only dependencies you verified.
## Key flows
Two short runtime flows. Use a Mermaid sequenceDiagram for each, then numbered steps with path:line.
## Suggested reading order
Five files, each with one sentence explaining why it matters.
## Build and test
The commands the repository documents.
## Risks and unknowns
What looks fragile, coupled, untested, or unverified. Say which are inferred.

Cite path:line for every component and risk. Do not invent files. Keep the whole answer under 1,800 words. Use a Mermaid flowchart only for a module overview; use sequenceDiagram for runtime flows.`;

export async function architectureMapKey(root: string): Promise<string> {
  const [head, status] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["status", "--porcelain"]),
  ]);
  if (!head) return "no-git";
  const digest = createHash("sha1")
    .update(`${head}\n${status ?? ""}`)
    .digest("hex");
  return digest;
}

export async function buildArchitectureMap(parent: ToolContext): Promise<string> {
  if (!parent.workspaceDir) throw new Error("Pick a workspace folder for this agent first");
  let calls = 0;
  const tools: AppTool[] = reviewTools().map((tool) => ({
    ...tool,
    handler: async (args, ctx) => {
      calls += 1;
      if (calls > MAP_CALLS) {
        throw new Error("The map budget is used. Finish the map from the files and lines you already have.");
      }
      return tool.handler(args, ctx);
    },
  }));
  const live = await openSession({
    model: parent.model || "auto",
    systemMessage: [
      MAP_SYSTEM,
      `Workspace folder: ${parent.workspaceDir}`,
      "Use list_dir, glob_files, search_text, file_read, read_many, git_status, git_diff, and git_log. Do not use shell.",
      `Stop when the map is ready. You have at most ${MAP_CALLS} tool calls.`,
    ].join("\n\n"),
    tools,
    getContext: () => ({ ...parent, explore: undefined, review: undefined }),
    onToolStart: () => undefined,
    onToolEnd: () => undefined,
  });
  try {
    const response = await live.session.sendAndWait({ prompt: "Map this repository." }, MAP_TIMEOUT_MS);
    const text = readAssistantText(response, "").trim();
    if (!text) throw new Error("The mapper returned an empty map. Try again.");
    return text.length > MAP_CHARS ? `${text.slice(0, MAP_CHARS)}\n\n…map truncated` : text;
  } finally {
    await closeLiveSession(live);
  }
}

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const result = await runArgv("git", args, root, GIT_TIMEOUT_MS);
    return result.code === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}
