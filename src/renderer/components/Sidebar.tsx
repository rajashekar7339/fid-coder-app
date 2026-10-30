import { useEffect, useRef, useState } from "react";
import {
  CircleHelp,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import type { CopilotUsageView } from "../../shared/copilot-usage";
import { formatUsageCount, formatUsageReset } from "../../shared/copilot-usage";
import type { Agent } from "../../shared/types";
import { agentSubtitle, isRecentlyActive } from "../agent-display";
import { formatRelativeTime } from "../format";
import { AgentAvatar } from "./AgentAvatar";
import { BrandMark } from "./BrandMark";
import { UsageBar } from "./UsageBar";

export type CopilotPresence = "unknown" | "checking" | "ready" | "out";

type Props = {
  agents: Agent[];
  selectedId: string | null;
  copilotPresence: CopilotPresence;
  loginName: string | null;
  signedIn: boolean;
  usage: CopilotUsageView | null;
  onSelect: (agentId: string) => void;
  onCreate: () => void;
  onEdit: (agent: Agent) => void;
  onDelete: (agent: Agent) => void;
  onSettings: () => void;
  onHelp: () => void;
};

type AgentMenu = { agent: Agent; x: number; y: number };

const MENU_WIDTH = 156;
const MENU_HEIGHT = 84;

function copilotLabel(presence: CopilotPresence): string {
  if (presence === "ready") return "Copilot ready";
  if (presence === "checking") return "Checking Copilot…";
  if (presence === "unknown") return "Checking Copilot…";
  return "Sign in to Copilot";
}

function initial(value: string | null): string {
  return value?.trim().charAt(0).toUpperCase() || "C";
}

function usageTitle(usage: CopilotUsageView): string {
  const label = usage.label.toLowerCase();
  const parts = [
    usage.included === null
      ? `${formatUsageCount(usage.used)} ${label} used`
      : `${formatUsageCount(usage.used)} of ${formatUsageCount(usage.included)} ${label} used`,
  ];
  if (usage.remaining !== null) parts.push(`${formatUsageCount(usage.remaining)} left`);
  if (usage.overage > 0) parts.push(`${formatUsageCount(usage.overage)} over`);
  const reset = formatUsageReset(usage.resetsAt);
  if (reset) parts.push(`resets ${reset}`);
  return parts.join(" · ");
}

function placeMenu(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8)),
  };
}

export function Sidebar({
  agents,
  selectedId,
  copilotPresence,
  loginName,
  signedIn,
  usage,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
  onSettings,
  onHelp,
}: Props) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<AgentMenu | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? agents.filter((agent) =>
        `${agent.name} ${agent.description}`.toLowerCase().includes(needle),
      )
    : agents;
  const menuAgent = menu && agents.some((agent) => agent.id === menu.agent.id) ? menu.agent : null;

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector("[aria-modal='true']")) return;
        event.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!menu) return;
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (menuRef.current?.contains(target) || target.closest("[data-menu-trigger]")) return;
      setMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function openMenu(agent: Agent, x: number, y: number) {
    const placed = placeMenu(x, y);
    setMenu({ agent, ...placed });
  }

  const accountName = loginName || "Copilot";
  const checking = copilotPresence === "checking" || copilotPresence === "unknown";

  return (
    <aside className="sidebar" aria-label="Agent sidebar">
      <header className="sidebar-brand">
        <BrandMark />
        <span className="wordmark">
          fid <span>coder</span>
        </span>
        <button className="icon-button" type="button" aria-label="New agent" onClick={onCreate}>
          <Plus size={16} />
        </button>
      </header>

      <div className="sidebar-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={search}
          value={query}
          placeholder="Search agents"
          aria-label="Search agents"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
              event.currentTarget.blur();
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              search.current?.focus();
            }}
          >
            <X size={12} />
          </button>
        ) : (
          <kbd>Ctrl K</kbd>
        )}
      </div>

      <div className="sidebar-section-label">
        <span>Agents</span>
        <span className="count">{agents.length}</span>
      </div>

      <nav
        className="agent-list"
        aria-label="Agents"
        onScroll={() => {
          if (menu) setMenu(null);
        }}
      >
        {visible.length === 0 ? (
          <p className="sidebar-empty">
            {agents.length === 0 ? "No agents yet." : "No matching agents."}
          </p>
        ) : (
          visible.map((agent) => {
            const active = agent.id === selectedId;
            const presence = signedIn && isRecentlyActive(agent.lastActivityAt) ? "recent" : "idle";
            return (
              <div
                className={`agent-row-wrap ${menu?.agent.id === agent.id ? "has-open-menu" : ""}`}
                key={agent.id}
              >
                <button
                  type="button"
                  className={`agent-row ${active ? "is-active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setMenu(null);
                    onSelect(agent.id);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu(agent, event.clientX, event.clientY);
                  }}
                >
                  <AgentAvatar agent={agent} size="md" presence={presence} />
                  <span className="agent-copy">
                    <span className="agent-name">{agent.name}</span>
                    <span className="agent-meta">{agentSubtitle(agent)}</span>
                  </span>
                  <span className="agent-when">
                    {agent.lastActivityAt ? formatRelativeTime(agent.lastActivityAt) : "New"}
                  </span>
                </button>
                <button
                  type="button"
                  data-menu-trigger
                  className="agent-menu-trigger"
                  aria-label={`Actions for ${agent.name}`}
                  aria-haspopup="menu"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (menu?.agent.id === agent.id) {
                      setMenu(null);
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    openMenu(agent, rect.right - MENU_WIDTH, rect.bottom + 4);
                  }}
                >
                  <MoreHorizontal size={15} />
                </button>
              </div>
            );
          })
        )}
      </nav>

      <button type="button" className="new-agent-row" onClick={onCreate}>
        <Plus size={14} aria-hidden="true" />
        New agent
      </button>

      <div className="sidebar-bottom">
        <div className="local-note">
          <div>
            <span className="presence-dot is-ready" />
            Working locally
          </div>
          <p>Agents use this PC for browser, files, and shell.</p>
        </div>
        <button type="button" className="help-row" aria-label="Open help and guide" onClick={onHelp}>
          <CircleHelp size={15} aria-hidden="true" />
          <span>Help &amp; guide</span>
          <kbd>F1</kbd>
        </button>
        <button type="button" className="account-row" aria-label="Open settings" onClick={onSettings}>
          <span className="user-avatar" aria-hidden="true">
            {initial(loginName)}
          </span>
          <span className="account-copy">
            <span className="account-name">{accountName}</span>
            <span className={`account-state ${checking ? "is-checking" : ""}`} aria-live="polite">
              <span className={`presence-dot ${signedIn ? "is-ready" : "is-off"}`} />
              {copilotLabel(copilotPresence)}
            </span>
            {usage && !usage.unlimited && usage.remainingPercent !== null ? (
              <UsageBar
                percent={usage.remainingPercent}
                blocked={usage.blocked}
                label={`Copilot ${usage.label.toLowerCase()}: ${formatUsageCount(usage.remainingPercent)}% remaining`}
                title={usageTitle(usage)}
                className="is-compact"
              />
            ) : null}
          </span>
          <Settings size={14} aria-hidden="true" className="account-settings" />
        </button>
      </div>

      {menuAgent && menu ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${menuAgent.name}`}
          className="agent-menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(null);
              onEdit(menuAgent);
            }}
          >
            <Pencil size={13} aria-hidden="true" />
            Edit agent
          </button>
          <button
            type="button"
            role="menuitem"
            className="is-danger"
            onClick={() => {
              setMenu(null);
              onDelete(menuAgent);
            }}
          >
            <Trash2 size={13} aria-hidden="true" />
            Delete agent
          </button>
        </div>
      ) : null}
    </aside>
  );
}
