import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Play, Plus, Trash2, X } from "lucide-react";
import type { Agent, Routine } from "../../shared/types";
import { errorText, fid } from "../fid";
import { formatNextRun, formatRelativeTime } from "../format";
import {
  cronFromSchedule,
  emptySchedule,
  scheduleFromCron,
  scheduleLabel,
  WEEKDAYS,
  type RoutineFrequency,
  type RoutineSchedule,
} from "../routine-schedule";
import { Modal } from "./Modal";
import { Switch } from "./Switch";

type Props = {
  agent: Agent;
  routines: Routine[];
  onClose: () => void;
  onRefresh: () => Promise<Routine[]>;
};

type Selection = { kind: "routine"; id: string } | { kind: "new" };

export function RoutinesDialog({ agent, routines, onClose, onRefresh }: Props) {
  const [list, setList] = useState(routines);
  const [selection, setSelection] = useState<Selection>(() =>
    routines[0] ? { kind: "routine", id: routines[0].id } : { kind: "new" },
  );

  useEffect(() => setList(routines), [routines]);

  useEffect(() => {
    if (selection.kind === "routine" && !list.some((routine) => routine.id === selection.id)) {
      setSelection(list[0] ? { kind: "routine", id: list[0].id } : { kind: "new" });
    }
  }, [list, selection]);

  const selected = selection.kind === "routine" ? (list.find((routine) => routine.id === selection.id) ?? null) : null;

  async function refresh() {
    const next = await onRefresh();
    setList(next);
    return next;
  }

  async function saved(routine: Routine) {
    const next = await refresh();
    setSelection(next.some((item) => item.id === routine.id) ? { kind: "routine", id: routine.id } : { kind: "new" });
  }

  async function deleted() {
    const next = await refresh();
    setSelection(next[0] ? { kind: "routine", id: next[0].id } : { kind: "new" });
  }

  return (
    <Modal label={`Routines for ${agent.name}`} className="routines-modal" onClose={onClose}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">{agent.name}</div>
          <div className="modal-title">Routines</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close routines" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="routines-body">
        <nav className="routines-nav" aria-label="Agent routines">
          <div className="routines-nav-head">
            <span>
              {list.length} {list.length === 1 ? "routine" : "routines"}
            </span>
            <button
              type="button"
              className="desk-icon-button"
              aria-label="New routine"
              onClick={() => setSelection({ kind: "new" })}
            >
              <Plus size={12} />
            </button>
          </div>

          <div className="routines-nav-list">
            {list.map((routine) => (
              <button
                key={routine.id}
                type="button"
                className={`routines-nav-item ${selected?.id === routine.id ? "is-active" : ""}`}
                onClick={() => setSelection({ kind: "routine", id: routine.id })}
              >
                <span className={`routine-nav-title ${routine.enabled ? "" : "is-paused"}`}>
                  <span className={`routine-nav-dot ${routine.enabled ? "" : "is-paused"}`} />
                  {routine.name}
                </span>
                <span className="routine-nav-meta">
                  {scheduleLabel(routine.cron)}
                  {routine.enabled && routine.nextRunAt ? ` · ${formatNextRun(routine.nextRunAt)}` : ""}
                </span>
              </button>
            ))}
            {list.length === 0 ? <p className="routines-nav-empty">Nothing scheduled yet.</p> : null}
          </div>

          <button type="button" className="new-routine-button" onClick={() => setSelection({ kind: "new" })}>
            <Plus size={13} />
            New routine
          </button>
          <div className="routines-nav-foot">
            Routines run while Fid Coder is open. Notifications appear in Windows.
          </div>
        </nav>

        <RoutineEditor
          key={selected?.id ?? "new"}
          agentId={agent.id}
          routine={selected}
          onSaved={saved}
          onDeleted={deleted}
          onClose={onClose}
        />
      </div>
    </Modal>
  );
}

function RoutineEditor({
  agentId,
  routine,
  onSaved,
  onDeleted,
  onClose,
}: {
  agentId: string;
  routine: Routine | null;
  onSaved: (routine: Routine) => Promise<void>;
  onDeleted: () => Promise<void>;
  onClose: () => void;
}) {
  const initial = routine ? scheduleFromCron(routine.cron) : emptySchedule();
  const [name, setName] = useState(routine?.name ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [notify, setNotify] = useState(routine?.notify ?? true);
  const [frequency, setFrequency] = useState<RoutineFrequency>(initial.frequency);
  const [time, setTime] = useState(initial.time);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [custom, setCustom] = useState(initial.custom);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const schedule: RoutineSchedule = { frequency, time, weekday, custom };
  const cron = cronFromSchedule(schedule);
  const unchangedSchedule = Boolean(routine && routine.cron.trim() === cron.trim());
  const showNext = Boolean(enabled && routine?.nextRunAt && unchangedSchedule);
  const dirty = Boolean(
    !routine ||
      name !== routine.name ||
      prompt !== routine.prompt ||
      cron.trim() !== routine.cron.trim() ||
      enabled !== routine.enabled ||
      notify !== routine.notify,
  );

  async function runNow() {
    if (!routine || busy || runningNow || dirty) return;
    setRunningNow(true);
    setError(null);
    try {
      const updated = await fid().routines.run(routine.id);
      setRunningNow(false);
      await onSaved(updated);
    } catch (caught) {
      setError(errorText(caught));
      setRunningNow(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError("Give this routine a name.");
      return;
    }
    if (!prompt.trim()) {
      setError("Tell the agent what to do.");
      return;
    }
    if (!cron.trim()) {
      setError("Add a cron expression for the custom schedule.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { name: name.trim(), prompt: prompt.trim(), cron, enabled, notify };
      const next = routine
        ? await fid().routines.update(routine.id, input)
        : await fid().routines.create({ agentId, ...input });
      await onSaved(next);
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }

  async function remove() {
    if (!routine || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fid().routines.delete(routine.id);
      await onDeleted();
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }

  return (
    <form className="routine-editor" onSubmit={(event) => void save(event)}>
      <div className="routine-editor-scroll">
        <div className="editor-titlebar">
          <h2>{routine?.name || "New routine"}</h2>
          <span className={`editor-active ${enabled ? "is-on" : ""}`}>
            <Switch checked={enabled} label="Routine enabled" onChange={setEnabled} />
            {enabled ? "Active" : "Paused"}
          </span>
          {routine ? (
            <div className="editor-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="Run routine now"
                title={dirty ? "Save changes before running" : "Run routine now"}
                disabled={busy || runningNow || dirty}
                onClick={() => void runNow()}
              >
                {runningNow ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
              </button>
            </div>
          ) : null}
        </div>

        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            autoFocus
            value={name}
            placeholder="Morning ticket sweep"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <label className="field">
          <span className="field-label">Instruction</span>
          <textarea
            className="textarea routine-instruction"
            value={prompt}
            placeholder="Tell the agent what to do when this routine runs."
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>

        <div className="field">
          <span className="field-label">
            When to run <span className="field-optional">Local time</span>
          </span>
          <div
            className={`schedule-grid ${frequency === "weekly" ? "has-day" : ""} ${frequency === "custom" ? "is-custom" : ""}`}
          >
            <label className="sub-field">
              <span>Frequency</span>
              <select
                className="select"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as RoutineFrequency)}
              >
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Every week</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {frequency === "weekly" ? (
              <label className="sub-field">
                <span>Day</span>
                <select className="select" value={weekday} onChange={(event) => setWeekday(event.target.value)}>
                  {WEEKDAYS.map((day) => (
                    <option key={day.value} value={day.value}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {frequency !== "custom" ? (
              <label className="sub-field">
                <span>Time</span>
                <input className="input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
              </label>
            ) : (
              <label className="sub-field is-wide">
                <span>Cron expression</span>
                <input
                  className="input mono-input"
                  value={custom}
                  placeholder="0 9 * * 1-5"
                  onChange={(event) => setCustom(event.target.value)}
                />
              </label>
            )}
          </div>
          <span className="field-note">
            {frequency === "custom"
              ? "Five fields: minute, hour, day of month, month, day of week."
              : showNext
                ? `Next run ${formatNextRun(routine?.nextRunAt)}`
                : enabled
                  ? "Save to update the next run."
                  : "This routine is paused."}
          </span>
        </div>

        {routine?.lastRunAt ? (
          <div className={`routine-last-run ${routineStatusTone(routine.lastStatus)}`}>
            <span>Last run</span>
            <span>{formatRelativeTime(routine.lastRunAt)}</span>
            <strong title={routine.lastStatus ?? undefined}>{routineStatusLabel(routine.lastStatus)}</strong>
          </div>
        ) : null}

        {runningNow ? (
          <div className="routine-running" role="status">
            <Loader2 size={12} className="spin" aria-hidden="true" />
            Running now. The reply will appear in the conversation.
          </div>
        ) : null}

        <div className="inline-row">
          <div className="inline-row-copy">
            <span>Windows notification</span>
            <span>Notify when this routine finishes or needs input.</span>
          </div>
          <Switch checked={notify} label="Windows notification" onChange={setNotify} />
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className={`modal-footer routine-editor-footer ${confirmDelete ? "is-confirming" : ""}`}>
        {confirmDelete && routine ? (
          <>
            <span className="inline-confirm-copy">
              <strong>Delete “{routine.name}”?</strong> This cannot be undone.
            </span>
            <span className="footer-spacer" />
            <button
              type="button"
              className="btn btn-quiet"
              autoFocus
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-destructive"
              disabled={busy}
              onClick={() => void remove()}
            >
              <Trash2 size={12} aria-hidden="true" />
              {busy ? "Deleting…" : "Delete routine"}
            </button>
          </>
        ) : (
          <>
            {routine ? (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy || runningNow}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </button>
            ) : null}
            <span className="footer-spacer" />
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || runningNow}>
              {busy ? "Saving…" : routine ? "Save changes" : "Create routine"}
            </button>
          </>
        )}
      </footer>
    </form>
  );
}

function routineStatusLabel(status: string | null): string {
  if (!status) return "Unknown";
  if (status === "ok") return "Completed";
  if (status.startsWith("skipped")) return "Skipped";
  if (status.startsWith("error")) return "Failed";
  return status;
}

function routineStatusTone(status: string | null): string {
  if (status === "ok") return "is-success";
  if (status?.startsWith("error")) return "is-error";
  return "";
}
