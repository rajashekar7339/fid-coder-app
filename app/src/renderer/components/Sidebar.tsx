import type { Agent } from "../../shared/types";

export type CopilotPresence = "unknown" | "checking" | "ready" | "out";

type Props = {
  agents: Agent[];
  selectedId: string | null;
  settingsOpen: boolean;
  copilotPresence: CopilotPresence;
  onSelect: (agentId: string) => void;
  onCreate: () => void;
  onSettings: () => void;
};

function copilotLabel(presence: CopilotPresence): string {
  if (presence === "ready") return "Copilot ready";
  if (presence === "checking") return "Checking sign-in…";
  if (presence === "unknown") return "Checking Copilot…";
  return "Copilot not signed in";
}

export function Sidebar({ agents, selectedId, settingsOpen, copilotPresence, onSelect, onCreate, onSettings }: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col bg-zinc-950 text-zinc-100">
      <div className="px-4 py-4">
      </div>
      <div className="px-3">
        <button type="button" className="w-full rounded-md bg-white px-3 py-2 text-sm font-medium text-zinc-950" onClick={onCreate}>
          New agent
        </button>
      </div>
      <nav className="mt-3 flex-1 space-y-1 overflow-auto px-2">
        {agents.map((agent) => {
          const active = !settingsOpen && agent.id === selectedId;
          return (
            <button
              key={agent.id}
              type="button"
              className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm ${active ? "bg-zinc-800 text-white" : "text-zinc-300 hover:bg-zinc-900"}`}
              onClick={() => onSelect(agent.id)}
            >
              {agent.name}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-zinc-800 p-3">
        <div className="mb-2 flex items-center gap-2 px-1 text-xs text-zinc-400" aria-live="polite">
          <span
            className={`h-2 w-2 rounded-full ${copilotPresence === "ready" ? "bg-emerald-400" : "bg-amber-400"} ${copilotPresence === "checking" || copilotPresence === "unknown" ? "animate-pulse" : ""}`}
          />
          {copilotLabel(copilotPresence)}
        </div>
        <button
          type="button"
          className={`w-full rounded-md px-3 py-2 text-left text-sm ${settingsOpen ? "bg-zinc-800" : "hover:bg-zinc-900"}`}
          onClick={onSettings}
        >
          Settings
        </button>
      </div>
    </aside>
  );
}
