import { useEffect, useState } from "react";
import {
  Check,
  Clock3,
  ExternalLink,
  Folder,
  Monitor,
  PanelRightClose,
  Pencil,
  Plus,
} from "lucide-react";
import type { Agent, BrowserPreview, Routine } from "../../shared/types";
import { errorText, fid } from "../fid";
import { formatNextRun, formatRelativeTime } from "../format";
import { scheduleLabel } from "../routine-schedule";
import { Switch } from "./Switch";

type Props = {
  agent: Agent;
  routines: Routine[];
  onClose: () => void;
  onEdit: () => void;
  onOpenRoutines: () => void;
  onToggleRoutine: (routine: Routine) => Promise<void>;
};

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
  const shellEnabled = agent.toolProfile !== "browser";
  const workspaceNote = !shellEnabled
    ? "Browser tools only"
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
