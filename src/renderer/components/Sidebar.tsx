import { useEffect, useRef, useState } from "react";
import { modelLabel } from "../../shared/model";
import type { Agent, CopilotModel } from "../../shared/types";

export type CopilotPresence = "unknown" | "checking" | "ready" | "out";

type Props = {
  agents: Agent[];
  models: CopilotModel[];
  selectedId: string | null;
  copilotPresence: CopilotPresence;
  loginName: string | null;
  signedIn: boolean;
  onSelect: (agentId: string) => void;
  onCreate: () => void;
  onEdit: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
  onSettings: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
};

type RowMenu = { agentId: string; x: number; y: number };

const AVATAR_COLORS = ["bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-rose-600", "bg-violet-600", "bg-teal-600"];

function copilotLabel(presence: CopilotPresence): string {
  if (presence === "ready") return "Copilot ready";
  if (presence === "checking") return "Checking sign-in…";
  if (presence === "unknown") return "Checking Copilot…";
  return "Copilot not signed in";
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "A";
}

function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash + char.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash] ?? AVATAR_COLORS[0];
}

function placeMenu(x: number, y: number): { x: number; y: number } {
  const width = 176;
  const height = 88;
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

export function Sidebar({
  agents,
  models,
  selectedId,
  copilotPresence,
  loginName,
  signedIn,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onSettings,
  onSignIn,
  onSignOut,
}: Props) {
  const [query, setQuery] = useState("");
  const [rowMenu, setRowMenu] = useState<RowMenu | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const visible = needle ? agents.filter((agent) => agent.name.toLowerCase().includes(needle)) : agents;
  const menuAgent = rowMenu ? agents.find((agent) => agent.id === rowMenu.agentId) ?? null : null;

  useEffect(() => {
    if (!rowMenu && !accountOpen) return;
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || accountRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-menu-trigger]")) return;
      setRowMenu(null);
      setAccountOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setRowMenu(null);
      setAccountOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [rowMenu, accountOpen]);

  function openRowMenu(agentId: string, x: number, y: number) {
    setAccountOpen(false);
    setRowMenu({ agentId, ...placeMenu(x, y) });
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-[18px] pb-1 pt-4">
        <h2 className="text-[14px] font-medium">Agents</h2>
        <button
          type="button"
          className="rounded-full px-2 py-1 text-[14px] text-muted-foreground hover:text-foreground"
          onClick={onCreate}
        >
          + New
        </button>
      </div>
      <div className="px-2.5 pt-2">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-input px-3 text-muted-foreground focus-within:border-ring">
          <SearchIcon />
          <input
            className="w-full bg-transparent py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            value={query}
            placeholder="Search"
            aria-label="Search agents"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <nav className="mt-3 flex-1 space-y-0.5 overflow-auto px-2 pb-2" aria-label="Agents">
        {visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">{agents.length === 0 ? "No agents yet" : "No matching agents"}</p>
        ) : (
          visible.map((agent) => {
            const active = agent.id === selectedId;
            return (
              <div key={agent.id} className="group relative">
                <button
                  type="button"
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-[10px] pr-8 text-left ${active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent"}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setRowMenu(null);
                    onSelect(agent.id);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openRowMenu(agent.id, event.clientX, event.clientY);
                  }}
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-medium text-white ${avatarColor(agent.name)}`}>
                    {initial(agent.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{agent.name}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-faint-foreground">{modelLabel(agent.model, models)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  data-menu-trigger
                  className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  aria-label={`Actions for ${agent.name}`}
                  aria-haspopup="menu"
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    if (rowMenu?.agentId === agent.id) {
                      setRowMenu(null);
                      return;
                    }
                    openRowMenu(agent.id, rect.left, rect.bottom + 4);
                  }}
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    …
                  </span>
                </button>
              </div>
            );
          })
        )}
      </nav>
      <div ref={accountRef} className="relative border-t border-border px-2.5 py-3">
        <button
          type="button"
          data-menu-trigger
          className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-sidebar-accent"
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          aria-label={`Account menu, ${copilotLabel(copilotPresence)}`}
          onClick={() => {
            setRowMenu(null);
            setAccountOpen((open) => !open);
          }}
        >
          <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-sidebar-accent text-[14px] font-medium">
            {initial(loginName || "Copilot")}
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-sidebar ${copilotPresence === "ready" ? "bg-success" : "bg-warning"} ${copilotPresence === "checking" || copilotPresence === "unknown" ? "animate-pulse" : ""}`}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium">{loginName || "Copilot"}</span>
            <span className="block truncate text-[12.5px] text-faint-foreground" aria-live="polite">
              {copilotLabel(copilotPresence)}
            </span>
          </span>
        </button>
        {accountOpen ? (
          <div role="menu" aria-label="Account" className="absolute bottom-full left-2.5 right-2.5 z-20 mb-2 rounded-xl border border-border bg-card py-1 shadow-lg">
            <p className="px-3 py-2 text-[12.5px] text-muted-foreground">{copilotLabel(copilotPresence)}</p>
            <button
              type="button"
              role="menuitem"
              className="block h-9 w-full px-3 text-left text-[14px] hover:bg-accent"
              onClick={() => {
                setAccountOpen(false);
                onSettings();
              }}
            >
              Settings
            </button>
            {signedIn ? (
              <button
                type="button"
                role="menuitem"
                className="block h-9 w-full px-3 text-left text-[14px] hover:bg-accent"
                onClick={() => {
                  setAccountOpen(false);
                  onSignOut();
                }}
              >
                Sign out
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                className="block h-9 w-full px-3 text-left text-[14px] hover:bg-accent"
                onClick={() => {
                  setAccountOpen(false);
                  onSignIn();
                }}
              >
                Sign in
              </button>
            )}
          </div>
        ) : null}
      </div>
      {menuAgent && rowMenu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${menuAgent.name}`}
          className="fixed z-50 w-44 rounded-xl border border-border bg-card py-1 text-[14px] shadow-lg"
          style={{ left: rowMenu.x, top: rowMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="block h-9 w-full px-3 text-left hover:bg-accent"
            onClick={() => {
              setRowMenu(null);
              onEdit(menuAgent);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className="block h-9 w-full px-3 text-left text-destructive hover:bg-accent"
            onClick={() => {
              setRowMenu(null);
              onDelete(menuAgent);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.4 10.4 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
