import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ChevronRight,
  Clock3,
  History as HistoryIcon,
  ListChecks,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import type { Agent, Routine, RoutineRun } from "../../../shared/types";
import { ROUTINE_FAILURE_LIMIT } from "../../../shared/routine-guard";
import { routineStatusLabel, routineStatusTone, runDurationLabel } from "../../../shared/routine-runs";
import { errorText, fid } from "../../lib/fid";
import { formatNextRun, formatRelativeTime } from "../../lib/format";
import {
  cronFromSchedule,
  emptySchedule,
  localDateText,
  routineScheduleLabel,
  runAtFromSchedule,
  scheduleFromRoutine,
  WEEKDAYS,
  type RoutineFrequency,
  type RoutineSchedule,
} from "../../../shared/routine-schedule";
import { Modal } from "../ui/Modal";
import { Switch } from "../ui/Switch";

type Props = {
  agent: Agent;
  routines: Routine[];
  onClose: () => void;
  onRefresh: () => Promise<Routine[]>;
};

type Selection = { kind: "routine"; id: string } | { kind: "new" };

export function RoutinesDialog({ agent, routines, onClose, onRefresh }: Props) {
  const [list, setList] = useState(routines);
  const [pane, setPane] = useState<"edit" | "history">("edit");
  const [selection, setSelection] = useState<Selection>(() =>
    routines[0] ? { kind: "routine", id: routines[0].id } : { kind: "new" },
  );
  const openedEmpty = useRef(routines.length === 0);

  useEffect(() => setList(routines), [routines]);

  useEffect(() => {
    const first = routines[0];
    if (!openedEmpty.current || !first) return;
    openedEmpty.current = false;
    setSelection({ kind: "routine", id: first.id });
  }, [routines]);

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
          <div className="routines-view-tabs" role="group" aria-label="Routine views">
            <button
              type="button"
              className={`routines-view-tab ${pane === "edit" ? "is-active" : ""}`}
              aria-pressed={pane === "edit"}
              onClick={() => setPane("edit")}
            >
              <ListChecks size={12} aria-hidden="true" />
              Routines
            </button>
            <button
              type="button"
              className={`routines-view-tab ${pane === "history" ? "is-active" : ""}`}
              aria-pressed={pane === "history"}
              onClick={() => setPane("history")}
            >
              <HistoryIcon size={12} aria-hidden="true" />
              History
            </button>
          </div>

          <div className="routines-nav-head">
            <span>
              {list.length} {list.length === 1 ? "routine" : "routines"}
            </span>
          </div>

          <div className="routines-nav-list">
            {list.map((routine) => (
              <button
                key={routine.id}
                type="button"
                className={`routines-nav-item ${pane === "edit" && selected?.id === routine.id ? "is-active" : ""}`}
                onClick={() => {
                  setPane("edit");
                  setSelection({ kind: "routine", id: routine.id });
                }}
              >
                <span className={`routine-nav-title ${routine.enabled ? "" : "is-paused"}`}>
                  <span className={`routine-nav-dot ${routine.enabled ? "" : "is-paused"}`} />
                  {routine.name}
                </span>
                <span className="routine-nav-meta">
                  {routineScheduleLabel(routine)}
                  {!routine.once && routine.enabled && routine.nextRunAt
                    ? ` · ${formatNextRun(routine.nextRunAt)}`
                    : ""}
                </span>
              </button>
            ))}
            {list.length === 0 ? <p className="routines-nav-empty">No routines yet.</p> : null}
          </div>

          <button
            type="button"
            className="new-routine-button"
            onClick={() => {
              setPane("edit");
              setSelection({ kind: "new" });
            }}
          >
            <Plus size={13} />
            New routine
          </button>
        </nav>

        <div className="routines-main">
          <RoutineEditor
            key={selected?.id ?? "new"}
            agentId={agent.id}
            routine={selected}
            hidden={pane !== "edit"}
            onSaved={saved}
            onDeleted={deleted}
            onClose={onClose}
          />
          {pane === "history" ? (
            <RoutineHistory agentId={agent.id} onOpenChat={onClose} />
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function RoutineEditor({
  agentId,
  routine,
  hidden,
  onSaved,
  onDeleted,
  onClose,
}: {
  agentId: string;
  routine: Routine | null;
  hidden?: boolean;
  onSaved: (routine: Routine) => Promise<void>;
  onDeleted: () => Promise<void>;
  onClose: () => void;
}) {
  const initial = routine ? scheduleFromRoutine(routine) : emptySchedule();
  const [name, setName] = useState(routine?.name ?? "");
  const [prompt, setPrompt] = useState(routine?.prompt ?? "");
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [notify, setNotify] = useState(routine?.notify ?? true);
  const [readOnly, setReadOnly] = useState(routine?.readOnly ?? false);
  const [frequency, setFrequency] = useState<RoutineFrequency>(initial.frequency);
  const [time, setTime] = useState(initial.time);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [date, setDate] = useState(initial.date);
  const [custom, setCustom] = useState(initial.custom);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const schedule: RoutineSchedule = { frequency, time, weekday, date, custom };
  const cron = cronFromSchedule(schedule);
  const runAt = runAtFromSchedule(schedule);
  const once = frequency === "once";
  const scheduleChanged = Boolean(
    !routine ||
      cron.trim() !== routine.cron.trim() ||
      once !== routine.once ||
      (once && runAt !== routine.runAt),
  );
  const showNext = Boolean(enabled && routine?.nextRunAt && !scheduleChanged);
  const dirty = Boolean(
    !routine ||
      name !== routine.name ||
      prompt !== routine.prompt ||
      scheduleChanged ||
      enabled !== routine.enabled ||
      notify !== routine.notify ||
      readOnly !== routine.readOnly,
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
      setError("Add a cron expression for Custom.");
      return;
    }
    if (once && !runAt) {
      setError("Pick a date and time for the one-time run.");
      return;
    }
    if (once && runAt && enabled && Date.parse(runAt) <= Date.now()) {
      setError("That time has already passed. Pick a future time.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        prompt: prompt.trim(),
        cron,
        once,
        runAt: once ? runAt : null,
        enabled,
        notify,
        readOnly,
      };
      const next = routine
        ? await fid().routines.update(routine.id, input)
        : await fid().routines.create({ agentId, ...input });
      await onSaved(next);
      setBusy(false);
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
    <form className="routine-editor" hidden={hidden} onSubmit={(event) => void save(event)}>
      <div className="routine-editor-scroll">
        <div className="editor-titlebar">
          <h2>{name.trim() || "New routine"}</h2>
          <span className={`editor-active ${enabled ? "is-on" : ""}`}>
            <Switch checked={enabled} label="Routine enabled" onChange={setEnabled} />
            {enabled ? "Active" : "Paused"}
          </span>
          {routine && !enabled && routine.consecutiveFailures >= ROUTINE_FAILURE_LIMIT ? (
            <span className="field-note">Paused after 10 failures. Turn it on to try again.</span>
          ) : null}
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
            className={`schedule-grid ${frequency === "weekly" || frequency === "once" ? "has-day" : ""} ${frequency === "custom" ? "is-custom" : ""}`}
          >
            <label className="sub-field">
              <span>Frequency</span>
              <select
                className="select"
                value={frequency}
                onChange={(event) => {
                  const next = event.target.value as RoutineFrequency;
                  setFrequency(next);
                  if (next === "once" && !date) setDate(localDateText(new Date()));
                }}
              >
                <option value="once">Once</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Every week</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {frequency === "once" ? (
              <label className="sub-field">
                <span>Date</span>
                <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </label>
            ) : null}
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
              : frequency === "once"
                ? showNext
                  ? `Next run ${formatNextRun(routine?.nextRunAt)}`
                  : enabled
                    ? "Save to set the one-time run. A missed run is marked when Fid Coder is closed."
                    : "This routine is paused."
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
            <span>It should</span>
            <span>{readOnly ? "Only look and report. No file changes, shell, or questions." : "Do the work."}</span>
          </div>
          <Switch checked={readOnly} label="Only look and report" onChange={setReadOnly} />
        </div>

        <div className="inline-row">
          <div className="inline-row-copy">
            <span>Windows notification</span>
            <span>Notify when this routine finishes, fails, is skipped, or needs approval.</span>
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

function RoutineHistory({ agentId, onOpenChat }: { agentId: string; onOpenChat: () => void }) {
  const [runs, setRuns] = useState<RoutineRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRuns(await fid().routines.history(agentId));
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function stop(runId: string) {
    setStopping(runId);
    setError(null);
    try {
      await fid().routines.stop(runId);
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setStopping(null);
    }
  }

  const count = runs?.length ?? 0;
  return (
    <div className="routine-history">
      <div className="routine-history-head">
        <div>
          <h2>Run history</h2>
          <p>
            {runs === null
              ? "Loading recent runs…"
              : count === 0
                ? "Scheduled and manual runs for this agent."
                : `${count} ${count === 1 ? "run" : "runs"} · scheduled and manual`}
          </p>
        </div>
        <button
          type="button"
          className="routine-history-refresh"
          aria-label="Refresh history"
          title="Refresh history"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? (
            <Loader2 size={12} className="spin" aria-hidden="true" />
          ) : (
            <RefreshCw size={12} aria-hidden="true" />
          )}
          <span>Refresh</span>
        </button>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {runs === null && loading ? (
        <div className="routine-history-empty" role="status">
          <Loader2 size={18} className="spin" aria-hidden="true" />
          <span>Loading runs…</span>
        </div>
      ) : runs === null ? (
        <div className="routine-history-empty">
          <Clock3 size={20} aria-hidden="true" />
          <strong>History could not be loaded</strong>
          <span>Choose Refresh to try again.</span>
        </div>
      ) : runs.length === 0 ? (
        <div className="routine-history-empty">
          <Clock3 size={20} aria-hidden="true" />
          <strong>No runs yet</strong>
          <span>Runs appear here after a routine fires or you choose Run now.</span>
        </div>
      ) : (
        <div className="routine-history-list">
          {runs.map((run) => {
            const tone = routineStatusTone(run.status);
            const excerpt = run.output ?? run.error ?? "";
            const meta = [
              run.trigger === "manual" ? "Manual" : "Scheduled",
              run.readOnly ? "Look and report" : null,
              runDurationLabel(run.startedAt, run.endedAt),
              formatRelativeTime(run.startedAt),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div className="routine-history-row" key={run.id}>
                <button
                  type="button"
                  className="routine-history-open"
                  aria-label={`Open chat for ${run.routineName}`}
                  onClick={onOpenChat}
                >
                  <span className="routine-history-main">
                    <span className="routine-history-title-line">
                      <span className="routine-name">{run.routineName}</span>
                      <span className={`routine-status-chip ${tone}`}>
                        {routineStatusLabel(run.status)}
                      </span>
                    </span>
                    <span className="routine-history-meta">{meta}</span>
                    {excerpt ? <span className="routine-history-excerpt">{excerpt}</span> : null}
                  </span>
                  <span className="routine-history-cta">
                    Open chat
                    <ChevronRight size={11} aria-hidden="true" />
                  </span>
                </button>
                {run.status === "running" ? (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    disabled={stopping === run.id}
                    onClick={() => void stop(run.id)}
                  >
                    {stopping === run.id ? "Stopping…" : "Stop"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
