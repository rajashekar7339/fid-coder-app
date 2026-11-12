import { useEffect, useState } from "react";
import {
  Check,
  Clock3,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  Monitor,
  PanelRightClose,
  Pencil,
  Plus,
} from "lucide-react";
import { approvalRecordLabel } from "../../../shared/approval";
import { changeTotals } from "../../../shared/changes";
import type {
  Agent,
  ApprovalRecord,
  BrowserPreview,
  ChangeSet,
  ChangesOpenRequest,
  Routine,
  WorkspaceRuleFile,
} from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { formatNextRun, formatRelativeTime } from "../../lib/format";
import { routineScheduleLabel } from "../../../shared/routine-schedule";
import { ApprovalHistoryDialog } from "../approvals/ApprovalHistoryDialog";
import { ContextDialog } from "./ContextDialog";
import { Switch } from "../ui/Switch";

type Props = {
  agent: Agent;
  routines: Routine[];
  latestChange: ChangeSet | null;
  changesLoading: boolean;
  changesError: string | null;
  onOpenChanges: (request?: ChangesOpenRequest) => void;
  onClose: () => void;
  onEdit: () => void;
  onOpenRoutines: () => void;
  onToggleRoutine: (routine: Routine) => Promise<void>;
};

export function AgentDesk({
  agent,
  routines,
  latestChange,
  changesLoading,
  changesError,
  onOpenChanges,
  onClose,
  onEdit,
  onOpenRoutines,
  onToggleRoutine,
}: Props) {
  const [preview, setPreview] = useState<BrowserPreview | null>(null);
  const [busyRoutine, setBusyRoutine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState<WorkspaceRuleFile[]>([]);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [creatingRules, setCreatingRules] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const workspaceNote =
    agent.toolProfile === "browser"
      ? agent.readOnly
        ? "Ask mode. Read-only browsing and Jira."
        : "Browser and Jira"
      : agent.readOnly
        ? agent.workspaceDir
          ? "Ask mode. Reads files and git; no edits or commands."
          : "Ask mode. Add a workspace for read-only file tools."
        : agent.workspaceDir
          ? "Agent mode. Shell + files enabled."
          : "Shell + files unavailable";
  const latestTotals = changeTotals(latestChange);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    setPreview(null);
    if (agent.toolProfile === "developer" || (agent.readOnly && agent.toolProfile !== "browser")) {
      return;
    }
    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const next = await fid().browser.preview(agent.id);
          if (!stopped) setPreview(next);
        } catch {
          if (!stopped) setPreview(null);
        }
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), 3000);
    }
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [agent.id, agent.toolProfile, agent.readOnly]);

  useEffect(() => {
    setContextOpen(false);
    setError(null);
    setApprovals([]);
    setApprovalsError(null);
    setHistoryOpen(false);
  }, [agent.id]);

  useEffect(() => {
    let cancelled = false;
    setRules([]);
    setRulesError(null);
    if (!agent.workspaceDir) return;
    fid()
      .workspace.rules(agent.id)
      .then((list) => {
        if (!cancelled) setRules(list);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setRulesError(errorText(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id, agent.workspaceDir, latestChange?.turnId]);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const next = await fid().approvals.history(agent.id, 6);
          if (!stopped) {
            setApprovals(next);
            setApprovalsError(null);
          }
        } catch (caught) {
          if (!stopped) setApprovalsError(errorText(caught));
        }
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), 5000);
    }
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [agent.id]);

  async function openBrowser() {
    setError(null);
    try {
      if (!(await fid().browser.focus(agent.id))) {
        setError("The browser window is no longer open.");
      }
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  async function toggleRoutine(routine: Routine) {
    setBusyRoutine(routine.id);
    setError(null);
    try {
      await onToggleRoutine(routine);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusyRoutine(null);
    }
  }

  async function createRules() {
    setCreatingRules(true);
    setRulesError(null);
    try {
      setRules(await fid().workspace.createRules(agent.id));
    } catch (caught) {
      setRulesError(errorText(caught));
    } finally {
      setCreatingRules(false);
    }
  }

  async function openRule(path: string) {
    setRulesError(null);
    try {
      await fid().workspace.openRule(agent.id, path);
    } catch (caught) {
      setRulesError(errorText(caught));
    }
  }

  return (
    <>
      <button
        type="button"
        className="desk-scrim"
        tabIndex={-1}
        aria-label="Close agent desk"
        onClick={onClose}
      />
      <aside className="agent-desk" aria-label="Agent desk">
        <header className="desk-header">
          <span className="desk-title">
            <span className={`presence-dot ${preview ? "is-ready" : "is-off"}`} />
            Agent desk
          </span>
          <button type="button" className="icon-button" aria-label="Close agent desk" onClick={onClose}>
            <PanelRightClose size={14} />
          </button>
        </header>

        <div className="desk-scroll">
          <section className="desk-section is-first">
            <div className="desk-section-head">
              <span>Browser</span>
              <span className={`desk-state ${preview ? "is-live" : ""}`}>{preview ? "Live" : "Idle"}</span>
            </div>
            {preview ? (
              <>
                <div className="browser-preview">
                  <div className="browser-chrome">
                    <span className="browser-favicon" />
                    <span className="browser-address">{hostLabel(preview.url)}</span>
                    <span className="browser-more" aria-hidden="true">
                      •••
                    </span>
                  </div>
                  <img src={preview.image} alt={`${preview.title || "Local browser"} preview`} />
                </div>
                <div className="browser-meta">
                  <span>{preview.title || hostLabel(preview.url)}</span>
                  <button type="button" onClick={() => void openBrowser()}>
                    Open browser
                    <ExternalLink size={10} aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : (
              <div className="browser-idle">
                <Monitor size={19} aria-hidden="true" />
                <p>
                  {agent.toolProfile === "developer" || (agent.readOnly && agent.toolProfile !== "browser")
                    ? "This agent has no browser tools."
                    : "Appears here when this agent opens its local browser."}
                </p>
              </div>
            )}
          </section>

          <section className="desk-section">
            <div className="desk-section-head">
              <span>Changes</span>
              {latestChange ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onOpenChanges({ turnId: latestChange.turnId })}
                >
                  Open changes
                </button>
              ) : null}
            </div>
            {changesError ? (
              <p className="desk-error" role="alert">
                {changesError}
              </p>
            ) : null}
            {latestChange ? (
              <button
                type="button"
                className="desk-change-summary"
                title="Open the latest file changes"
                onClick={() => onOpenChanges({ turnId: latestChange.turnId })}
              >
                <span className="desk-change-summary-top">
                  <span>
                    {latestChange.status === null
                      ? "Recording changes…"
                      : latestChange.source === "routine"
                        ? "Latest routine change"
                        : "Latest change"}
                  </span>
                  <span>{formatRelativeTime(latestChange.startedAt)}</span>
                </span>
                <span className="desk-change-summary-line">
                  {latestChange.files.length} file{latestChange.files.length === 1 ? "" : "s"}
                  <span className="desk-change-summary-stats">
                    <span className="diff-add">+{latestTotals.additions}</span>{" "}
                    <span className="diff-remove">−{latestTotals.deletions}</span>
                  </span>
                </span>
              </button>
            ) : (
              <p className="desk-empty-line">
                {changesLoading
                  ? "Loading changes…"
                  : agent.workspaceDir
                    ? "No file changes recorded."
                    : "No workspace folder."}
              </p>
            )}
            <p className="desk-note">Tracks file_write and apply_patch. Shell changes are not recorded.</p>
          </section>

          <section className="desk-section">
            <div className="desk-section-head">
              <span>Approvals</span>
              <button type="button" className="text-button" onClick={() => setHistoryOpen(true)}>
                History
              </button>
            </div>
            {approvalsError ? (
              <p className="desk-error" role="alert">
                {approvalsError}
              </p>
            ) : null}
            {approvals.length === 0 ? (
              <p className="desk-empty-line">No approval requests yet.</p>
            ) : (
              <div className="approval-desk-list">
                {approvals.map((record) => (
                  <div className="approval-desk-row" key={record.id}>
                    <span className={`approval-desk-dot is-${record.decision}`} />
                    <div className="approval-desk-copy">
                      <code className="approval-desk-command" title={record.command}>
                        {record.command}
                      </code>
                      <span className="approval-desk-meta">
                        {approvalRecordLabel(record)} · {formatRelativeTime(record.decidedAt ?? record.createdAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="desk-section">
            <div className="desk-section-head">
              <span>Routines</span>
              <button type="button" className="desk-icon-button" aria-label="Manage routines" onClick={onOpenRoutines}>
                <Plus size={12} />
              </button>
            </div>
            {routines.length === 0 ? (
              <p className="desk-empty-line">No routines yet.</p>
            ) : (
              <div className="desk-routines">
                {routines.map((routine) => (
                  <div className="desk-routine" key={routine.id}>
                    <span className={`routine-icon ${routine.enabled ? "is-on" : ""}`}>
                      <Clock3 size={12} aria-hidden="true" />
                    </span>
                    <div className="routine-copy">
                      <span className="routine-name">{routine.name}</span>
                      <span className="routine-meta">
                        {routineScheduleLabel(routine)}
                        {!routine.once && routine.enabled && routine.nextRunAt
                          ? ` · ${formatNextRun(routine.nextRunAt)}`
                          : routine.enabled
                            ? ""
                            : " · Paused"}
                      </span>
                    </div>
                    <Switch
                      checked={routine.enabled}
                      disabled={busyRoutine === routine.id}
                      label={`${routine.enabled ? "Disable" : "Enable"} ${routine.name}`}
                      onChange={() => void toggleRoutine(routine)}
                    />
                  </div>
                ))}
              </div>
            )}
            {error ? (
              <p className="desk-error" role="alert">
                {error}
              </p>
            ) : null}
          </section>

          <section className="desk-section">
            <div className="desk-section-head">
              <span>Workspace</span>
              {agent.workspaceDir ? (
                <button
                  type="button"
                  className="text-button is-browse"
                  onClick={() => onOpenChanges({})}
                >
                  <FolderOpen size={11} aria-hidden="true" />
                  Browse files
                </button>
              ) : null}
            </div>
            <div className="workspace-card">
              <span className="workspace-icon">
                <Folder size={13} aria-hidden="true" />
              </span>
              <div className="workspace-copy">
                <span className="workspace-path">{agent.workspaceDir || "No workspace"}</span>
                <span className="workspace-note">{workspaceNote}</span>
              </div>
              <button type="button" className="desk-icon-button" aria-label="Edit workspace" onClick={onEdit}>
                <Pencil size={11} />
              </button>
            </div>
          </section>

          <section className="desk-section">
            <div className="desk-section-head">
              <span>Project rules</span>
              {agent.workspaceDir ? (
                <button type="button" className="text-button" onClick={() => setContextOpen(true)}>
                  <Eye size={11} aria-hidden="true" />
                  Context
                </button>
              ) : null}
            </div>
            {rulesError ? (
              <p className="desk-error" role="alert">
                {rulesError}
              </p>
            ) : null}
            {!agent.workspaceDir ? (
              <p className="desk-empty-line">Set a workspace to load project rules.</p>
            ) : rules.length === 0 ? (
              <p className="desk-empty-line">No rules file yet. AGENTS.md is loaded on every turn.</p>
            ) : (
              <div className="rule-list">
                {rules.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    className="rule-row"
                    title={`Open ${file.path}`}
                    onClick={() => void openRule(file.path)}
                  >
                    <FileText size={11} aria-hidden="true" />
                    <span className="rule-path">{file.path}</span>
                    <span className="rule-size">{file.truncated ? "truncated" : `${file.chars} chars`}</span>
                  </button>
                ))}
              </div>
            )}
            {agent.workspaceDir && rules.length === 0 ? (
              <button
                type="button"
                className="text-button"
                disabled={creatingRules}
                onClick={() => void createRules()}
              >
                <Plus size={11} aria-hidden="true" />
                {creatingRules ? "Creating…" : "Create AGENTS.md"}
              </button>
            ) : null}
            {agent.workspaceDir ? (
              <p className="desk-note">AGENTS.md, CLAUDE.md, .fid/instructions.md, and Copilot instructions are loaded.</p>
            ) : null}
          </section>

          <div className="desk-spacer" />
          <div className="desk-activity">
            <span className="desk-activity-check">
              <Check size={8} aria-hidden="true" />
            </span>
            <span>
              {agent.lastActivityAt
                ? `Last active ${formatRelativeTime(agent.lastActivityAt)}`
                : "No activity yet"}
            </span>
            {agent.nextRoutineAt ? <span className="desk-when">Next {formatNextRun(agent.nextRoutineAt)}</span> : null}
          </div>
        </div>
      </aside>

      {contextOpen ? <ContextDialog agent={agent} onClose={() => setContextOpen(false)} /> : null}
      {historyOpen ? <ApprovalHistoryDialog agent={agent} onClose={() => setHistoryOpen(false)} /> : null}
    </>
  );
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
