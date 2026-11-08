import type { AgentToolProfile } from "./types";

export const DEFAULT_TOOL_PROFILE: AgentToolProfile = "all";

const TOOL_PROFILES: AgentToolProfile[] = ["all", "browser", "developer"];

export function normalizeToolProfile(value: unknown): AgentToolProfile {
  return typeof value === "string" && TOOL_PROFILES.includes(value as AgentToolProfile)
    ? (value as AgentToolProfile)
    : DEFAULT_TOOL_PROFILE;
}
