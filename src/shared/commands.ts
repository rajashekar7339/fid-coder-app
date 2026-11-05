import type { AgentToolProfile } from "./types";

export type CommandInfo = {
  id: string;
  label: string;
  description: string;
  usage: string;
  category: "agent" | "app";
  profiles?: AgentToolProfile[];
  requiresWorkspace?: boolean;
  ui?: boolean;
};

export const COMMANDS: CommandInfo[] = [
  {
    id: "review",
    label: "Review a change",
    description: "Review a change with a read-only reviewer. Add staged, a branch, a PR number, or a path.",
    usage: "/review [staged | branch <name> | pr <number> | path]",
    category: "agent",
    profiles: ["all", "developer"],
    requiresWorkspace: true,
  },
  {
    id: "skills",
    label: "Edit agent skills",
    description: "Open this agent's skills editor.",
    usage: "/skills",
    category: "app",
    ui: true,
  },
  {
    id: "help",
    label: "Help & guide",
    description: "Open the in-app guide.",
    usage: "/help",
    category: "app",
    ui: true,
  },
];

export function filterCommands(query: string): CommandInfo[] {
  const needle = query.trim().toLowerCase().replace(/^\/+/, "");
  if (!needle) return COMMANDS;
  return COMMANDS.filter((command) =>
    `${command.id} ${command.label} ${command.description}`.toLowerCase().includes(needle),
  );
}

export function parseCommand(text: string): { command: CommandInfo; args: string } | null {
  const match = text.trim().match(/^\/([a-z-]+)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const command = COMMANDS.find((item) => item.id === match[1].toLowerCase());
  if (!command) return null;
  return { command, args: (match[2] ?? "").trim() };
}

export function commandAvailability(
  command: CommandInfo,
  profile: AgentToolProfile,
  hasWorkspace: boolean,
): string | null {
  if (command.requiresWorkspace && !hasWorkspace) return "Set a workspace folder first.";
  if (command.profiles && !command.profiles.includes(profile)) return "Needs developer tools.";
  return null;
}
