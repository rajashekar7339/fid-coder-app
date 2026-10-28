import type { AgentToolProfile } from "../shared/types";
import { browserTools } from "./browser";
import { fileTools } from "./files";
import { shellTools } from "./shell";
import type { AppTool } from "./types";

export function allTools(): AppTool[] {
  return [...browserTools, ...shellTools, ...fileTools];
}

export function toolsForAgent(profile: AgentToolProfile): AppTool[] {
  if (profile === "browser") return browserTools;
  if (profile === "developer") return [...shellTools, ...fileTools];
  return allTools();
}
