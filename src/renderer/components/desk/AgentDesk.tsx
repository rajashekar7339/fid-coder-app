import { useEffect, useState } from "react";
import {
  Check,
  Clock3,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  Monitor,
  PanelRightClose,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  Agent,
  BrowserPreview,
  ChangeSet,
  FileChangeSummary,
  FileDiff,
  Routine,
  WorkspaceRuleFile,
} from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { formatNextRun, formatRelativeTime } from "../../lib/format";
import { scheduleLabel } from "../../lib/routine-schedule";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { ContextDialog } from "./ContextDialog";
import { DiffView } from "./DiffView";
import { Modal } from "../ui/Modal";
import { Switch } from "../ui/Switch";

type Props = {
  agent: Agent;
  routines: Routine[];
  onClose: () => void;
  onEdit: () => void;
  onOpenRoutines: () => void;
  onToggleRoutine: (routine: Routine) => Promise<void>;
};

type Confirm = "turn" | "file";

export function AgentDesk({
  agent,
  routines,
  onClose,
  onEdit,
  onOpenRoutines,
  onToggleRoutine,
}: Props) {
  const [preview, setPreview] = useState<BrowserPreview | null>(null);
  const [busyRoutine, setBusyRoutine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<ChangeSet | null>(null);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [rules, setRules] = useState<WorkspaceRuleFile[]>([]);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [creatingRules, setCreatingRules] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const shellEnabled = agent.toolProfile !== "browser";
  const workspaceNote = !shellEnabled
    ? "Browser and Jira"
    : agent.workspaceDir
      ? "Shell + files enabled"
      : "Shell + files unavailable";

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    setPreview(null);
    if (agent.toolProfile === "developer") return;
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
  }, [agent.id, agent.toolProfile]);

  useEffect(() => {
    setDiff(null);
    setConfirm(null);
    setContextOpen(false);
    setError(null);
  }, [agent.id]);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    setChanges(null);
    setChangesError(null);
    if (!agent.workspaceDir) return;
    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const next = await fid().changes.latest(agent.id);
          if (!stopped) {
            setChanges(next);
            setChangesError(null);
          }
        } catch (caught) {
          if (!stopped) setChangesError(errorText(caught));
        }
      }
      if (!stopped) timer = window.setTimeout(() => void poll(), 3000);
    }
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [agent.id, agent.workspaceDir]);

  useEffect(() => {
    if (!agent.workspaceDir) return;
    let cancelled = false;
    fid()
      .changes.latest(agent.id)
      .then((next) => {
        if (cancelled) return;
        setChanges(next);
        setChangesError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setChangesError(errorText(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id, agent.workspaceDir, agent.lastActivityAt]);

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
  }, [agent.id, agent.workspaceDir, changes?.turnId]);

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

  async function openDiff(file: FileChangeSummary) {
    try {
      setDiff(await fid().changes.diff(file.id));
    } catch (caught) {
      setChangesError(errorText(caught));
    }
  }

  async function refreshChanges() {
    try {
      setChanges(await fid().changes.latest(agent.id));
      setChangesError(null);
    } catch (caught) {
      setChangesError(errorText(caught));
    }
  }

  async function revertFile() {
    if (!diff) return;
    await fid().changes.revert(diff.id);
    setDiff(null);
    setConfirm(null);
    await refreshChanges();
  }

  async function revertTurn() {
    if (!changes) return;
    await fid().changes.revertTurn(changes.turnId);
    setConfirm(null);
    setDiff(null);
    await refreshChanges();
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
                  {agent.toolProfile === "developer"
                    ? "This agent has no browser tools."
                    : "Appears here when this agent opens its local browser."}
                </p>
              </div>
            )}
          </section>

          <section className="desk-section">
            <div className="desk-section-head">
              <span>Changes</span>
              {changes ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={changes.status === null || !changes.files.every((file) => file.revertible)}
                  title={
                    changes.status === null
                      ? "Wait for the turn to finish"
                      : changes.files.every((file) => file.revertible)
                        ? undefined
                        : "Some files cannot be restored"
                  }
                  onClick={() => setConfirm("turn")}
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  Revert turn
                </button>
              ) : null}
            </div>
            {changesError ? (
              <p className="desk-error" role="alert">
                {changesError}
              </p>
            ) : null}
            {changes ? (
              <>
                <p className="desk-note">
                  {changes.source === "routine" ? "Latest routine change" : "Latest change"} ·{" "}
                  {formatRelativeTime(changes.startedAt)}
                </p>
                <div className="change-list">
                  {changes.files.map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      className="change-row"
                      title={`View diff for ${file.path}`}
                      onClick={() => void openDiff(file)}
                    >
                      <span className={`change-kind is-${file.kind}`}>
                        {file.kind === "create" ? "new" : "edit"}
                      </span>
                      <span className="change-path">{file.path}</span>
                      <span className="change-stat">
                        <span className="diff-add">+{file.additions}</span>
                        <span className="diff-remove">−{file.deletions}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="desk-note">Tracks file_write and apply_patch. Shell changes are not recorded.</p>
              </>
            ) : (
              <p className="desk-empty-line">
                {agent.workspaceDir ? "No file changes recorded." : "No workspace folder."}
              </p>
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
                        {scheduleLabel(routine.cron)}
                        {routine.enabled && routine.nextRunAt
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

      {diff ? (
        <Modal label={`Changes to ${diff.path}`} className="diff-modal" onClose={() => setDiff(null)}>
          <header className="modal-header">
            <div className="modal-head-copy">
              <div className="modal-kicker">Turn change</div>
              <div className="modal-title">{diff.path}</div>
            </div>
            <button type="button" className="icon-button" aria-label="Close diff" onClick={() => setDiff(null)}>
              <X size={15} />
            </button>
          </header>
          <div className="diff-body">
            <DiffView diff={diff} />
            <div className="diff-actions">
              <button type="button" className="btn btn-quiet" onClick={() => setDiff(null)}>
                Close
              </button>
              <span className="footer-spacer" />
              <button
                type="button"
                className="btn btn-danger-outline"
                disabled={!diff.revertible}
                title={diff.revertible ? undefined : "This change is still being recorded or cannot be restored."}
                onClick={() => setConfirm("file")}
              >
                <RotateCcw size={12} aria-hidden="true" />
                Revert file
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {contextOpen ? <ContextDialog agent={agent} onClose={() => setContextOpen(false)} /> : null}

      {confirm === "turn" ? (
        <ConfirmDialog
          title="Revert turn"
          description={
            <>
              Restore every file this turn changed. Files created in the turn are removed. Files edited outside the
              turn are left alone.
            </>
          }
          confirmLabel="Revert turn"
          busyLabel="Reverting…"
          onCancel={() => setConfirm(null)}
          onConfirm={revertTurn}
        />
      ) : null}

      {confirm === "file" ? (
        <ConfirmDialog
          title="Revert file"
          description={
            <>
              Restore <strong>{diff?.path}</strong> to the version before this turn. If the file changed after the
              turn, the revert is refused.
            </>
          }
          confirmLabel="Revert file"
          busyLabel="Reverting…"
          onCancel={() => setConfirm(null)}
          onConfirm={revertFile}
        />
      ) : null}
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
