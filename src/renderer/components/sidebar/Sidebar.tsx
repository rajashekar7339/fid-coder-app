import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  CircleHelp,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { arrangeAgentList } from "../../../shared/agent-list";
import type { CopilotUsageView } from "../../../shared/copilot-usage";
import { formatUsageCount, formatUsageReset } from "../../../shared/copilot-usage";
import type { Agent, AgentPlacement } from "../../../shared/types";
import { agentSubtitle, isRecentlyActive } from "../../lib/agent-display";
import { formatActivityDay, formatFullTimestamp } from "../../lib/format";
import { AgentAvatar } from "../agents/AgentAvatar";
import { BrandMark } from "../ui/BrandMark";
import { UsageBar, usageLevel } from "../ui/UsageBar";

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
  onPlace: (agent: Agent, placement: AgentPlacement) => void;
  onDelete: (agent: Agent) => void;
  onSettings: () => void;
  onSkills: () => void;
  onHelp: () => void;
};

type AgentMenu = { agent: Agent; x: number; y: number };

const MENU_WIDTH = 156;
const MENU_ITEM_HEIGHT = 31;
const MENU_PAD = 8;

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

function menuHeight(agent: Agent): number {
  return (agent.archived ? 3 : 4) * MENU_ITEM_HEIGHT + MENU_PAD;
}

function placeMenu(x: number, y: number, height: number): { x: number; y: number } {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}

function whenLabel(agent: Agent): string {
  if (agent.archived) return "Archived";
  return agent.lastActivityAt ? formatActivityDay(agent.lastActivityAt) : "New";
}

function whenTitle(agent: Agent): string | undefined {
  if (!agent.lastActivityAt) return agent.archived ? "Archived" : undefined;
  const stamp = formatFullTimestamp(agent.lastActivityAt);
  return agent.archived ? `Archived · ${stamp}` : stamp;
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
  onPlace,
  onDelete,
  onSettings,
  onSkills,
  onHelp,
}: Props) {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<AgentMenu | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sawArchivedSelection = useRef(false);
  const needle = query.trim();
  const { listed, archived } = arrangeAgentList(agents, query);
  const menuAgent = menu ? (agents.find((agent) => agent.id === menu.agent.id) ?? null) : null;
  const selectedIsArchived = Boolean(
    selectedId && agents.some((agent) => agent.id === selectedId && agent.archived),
  );

  useEffect(() => {
    if (selectedIsArchived && !sawArchivedSelection.current) setArchiveOpen(true);
    sawArchivedSelection.current = selectedIsArchived;
  }, [selectedIsArchived]);

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector("[aria-modal='true']")) return;
        event.preventDefault();
        setMenu(null);
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
    const placed = placeMenu(x, y, menuHeight(agent));
    setMenu({ agent, ...placed });
  }

  function changeQuery(value: string) {
    setQuery(value);
    setMenu(null);
  }

  const accountName = loginName || "Copilot";
  const checking = copilotPresence === "checking" || copilotPresence === "unknown";

  function renderAgent(agent: Agent) {
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
            <span className="agent-name">
              {agent.pinned ? (
                <span className="agent-pin" title="Pinned">
                  <Pin size={12} aria-hidden="true" />
                </span>
              ) : null}
              <span className="agent-name-text">{agent.name}</span>
            </span>
            <span className="agent-meta">{agentSubtitle(agent)}</span>
          </span>
          <span className="agent-when" title={whenTitle(agent)}>
            {whenLabel(agent)}
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
  }

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
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              changeQuery("");
              event.currentTarget.blur();
            }
            if (event.key === "Enter" && needle && listed[0]) {
              event.preventDefault();
              setMenu(null);
              onSelect(listed[0].id);
            }
          }}
        />
        {query ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => {
              changeQuery("");
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
        <span className="count">{listed.length}</span>
      </div>

      <nav
        className="agent-list"
        aria-label="Agents"
        onScroll={() => {
          if (menu) setMenu(null);
        }}
      >
        {listed.length === 0 && needle ? <p className="sidebar-empty">No matching agents.</p> : null}
        {listed.length === 0 && !needle && agents.length === 0 ? (
          <p className="sidebar-empty">No agents yet.</p>
        ) : null}
        {listed.map(renderAgent)}
        {archived.length > 0 ? (
          <div className="archive-group">
            <button
              type="button"
              className="sidebar-section-label is-disclosure"
              aria-expanded={archiveOpen}
              onClick={() => setArchiveOpen((open) => !open)}
            >
              <ChevronRight
                size={12}
                aria-hidden="true"
                className={`disclosure-chevron ${archiveOpen ? "is-open" : ""}`}
              />
              <span>Archived</span>
              <span className="count">{archived.length}</span>
            </button>
            {archiveOpen ? archived.map(renderAgent) : null}
          </div>
        ) : null}
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
        <button type="button" className="help-row" aria-label="Open skills" onClick={onSkills}>
          <Wrench size={15} aria-hidden="true" />
          <span>Skills</span>
        </button>
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
            {usage && !usage.unlimited && usage.usedPercent !== null ? (
              <span className="account-usage">
                <UsageBar
                  percent={usage.usedPercent}
                  blocked={usage.blocked}
                  label={`Copilot ${usage.label.toLowerCase()}: ${formatUsageCount(usage.usedPercent)}% used`}
                  title={usageTitle(usage)}
                  className="is-compact"
                />
                <span
                  className={`usage-percent is-compact is-${usageLevel(usage.usedPercent, usage.blocked)}`}
                >
                  {formatUsageCount(usage.usedPercent)}%
                </span>
              </span>
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
          {menuAgent.archived ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                onPlace(menuAgent, { archived: false });
              }}
            >
              <ArchiveRestore size={13} aria-hidden="true" />
              Restore
            </button>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  onPlace(menuAgent, { pinned: !menuAgent.pinned });
                }}
              >
                {menuAgent.pinned ? (
                  <PinOff size={13} aria-hidden="true" />
                ) : (
                  <Pin size={13} aria-hidden="true" />
                )}
                {menuAgent.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  onPlace(menuAgent, { archived: true });
                }}
              >
                <Archive size={13} aria-hidden="true" />
                Archive
              </button>
            </>
          )}
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
