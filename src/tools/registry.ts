import { browserTools } from "./browser";
import { fileTools } from "./files";
import { shellTools } from "./shell";
import type { AppTool } from "./types";

export function allTools(): AppTool[] {
  return [...browserTools, ...shellTools, ...fileTools];
}

export function toolNames(): string[] {
  return allTools().map((tool) => tool.name);
}
