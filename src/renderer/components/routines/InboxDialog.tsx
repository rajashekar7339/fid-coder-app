import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ListChecks, X } from "lucide-react";
import type { InboxItem, InboxView } from "../../../shared/inbox";
import { inboxUpdates } from "../../../shared/inbox";
import { groupByAgent, groupRoutineBoard } from "../../../shared/needs-you";
import { ROUTINE_FAILURE_LIMIT } from "../../../shared/routine-guard";
import { routineStatusLabel, routineStatusTone } from "../../../shared/routine-runs";
import { routineScheduleLabel } from "../../../shared/routine-schedule";
import type {
  ApprovalAction,
  ApprovalRequest,
  BrowserHandoffRequest,
  QuestionReply,
  QuestionRequest,
  RoutineOverview,
  SkillSaveRequest,
} from "../../../shared/types";
import type { SkillDraftInput } from "../../../shared/skill-draft";
import { errorText, fid } from "../../lib/fid";
import { formatNextRun, formatRelativeTime } from "../../lib/format";
import { ApprovalCard } from "../approvals/ApprovalCard";
import { HandoffCard } from "../approvals/HandoffCard";
import { QuestionCard } from "../approvals/QuestionCard";
import { SkillSaveCard } from "../approvals/SkillSaveCard";
import { Modal } from "../ui/Modal";
import { Switch } from "../ui/Switch";

type Notice = { id: string; text: string } | null;

type Props = {
  view: InboxView;
  approvals: ApprovalRequest[];
  questions: QuestionRequest[];
  handoffs: BrowserHandoffRequest[];
  skillSaves: SkillSaveRequest[];
  approvalBusyId: string | null;
  questionBusyId: string | null;
  handoffBusyId: string | null;
  skillSaveBusyId: string | null;
  approvalError: Notice;
  questionError: Notice;
  handoffError: Notice;
  skillSaveError: Notice;
  onClose: () => void;
  onOpen: (item: InboxItem) => void;
  onSnooze: (item: InboxItem) => void;
  onDismiss: (item: InboxItem) => void;
  onOpenAgent: (agentId: string) => void;
  onDecideApproval: (id: string, action: ApprovalAction) => void;
  onAnswerQuestion: (id: string, reply: QuestionReply) => void;
  onTakeoverHandoff: (id: string) => void;
  onCompleteHandoff: (id: string) => void;
  onDecideSkillSave: (id: string, allow: boolean, draft?: SkillDraftInput) => void;
  onOpenRoutines: (agentId: string) => void;
};

type WaitingRow =
  | (ApprovalRequest & { waitingKind: "approval" })
  | (QuestionRequest & { waitingKind: "question" })
  | (BrowserHandoffRequest & { waitingKind: "handoff" })
  | (SkillSaveRequest & { waitingKind: "skill-save" });

export function InboxDialog(props: Props) {
  const [pane, setPane] = useState<"needs" | "routines">("needs");
  const updates = inboxUpdates(props.view.items);
  const waiting = waitingRows(props);

  return (
    <Modal label="Needs you" className="inbox-modal" onClose={props.onClose}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">Fid Coder</div>
          <div className="modal-title">Needs you</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close inbox" onClick={props.onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="inbox-body">
        <div className="routines-view-tabs inbox-tabs" role="group" aria-label="Inbox views">
          <button
            type="button"
            className={`routines-view-tab ${pane === "needs" ? "is-active" : ""}`}
            aria-pressed={pane === "needs"}
            onClick={() => setPane("needs")}
          >
            Needs you
          </button>
          <button
            type="button"
            className={`routines-view-tab ${pane === "routines" ? "is-active" : ""}`}
            aria-pressed={pane === "routines"}
            onClick={() => setPane("routines")}
          >
            <ListChecks size={12} aria-hidden="true" />
            Routines
          </button>
        </div>
        {pane === "needs" ? (
          <NeedsPane {...props} updates={updates} waiting={waiting} />
        ) : (
          <RoutinesPane onOpenRoutines={props.onOpenRoutines} />
        )}
      </div>
    </Modal>
  );
}

function NeedsPane({
  updates,
  waiting,
  ...props
}: Props & { updates: InboxItem[]; waiting: WaitingRow[] }) {
  const groups = groupByAgent(waiting);
  if (groups.length === 0 && updates.length === 0) {
    return <p className="field-note">Nothing is waiting.</p>;
  }
  return (
    <>
      {groups.length > 0 ? (
        <section className="inbox-section" aria-label="Waiting on you">
          <h2 className="inbox-section-label">Waiting on you</h2>
          {groups.map((group) => (
            <div className="inbox-agent-block" key={group.agentId}>
              <AgentHeading
                agentName={group.agentName}
                count={group.count}
                onOpen={() => props.onOpenAgent(group.agentId)}
              />
              <div className="inbox-waiting">
                {group.items.map((row) => (
                  <WaitingCard key={row.id} row={row} {...props} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {updates.length > 0 ? (
        <section className="inbox-section" aria-label="Updates">
          <h2 className="inbox-section-label">Updates</h2>
          <div className="inbox-list">
            {groupByAgent(updates).map((group) => (
              <div className="inbox-agent-block" key={group.agentId}>
                <AgentHeading agentName={group.agentName} count={group.count} />
                {group.items.map((item) => (
                  <div className="inbox-row" key={item.id}>
                    <button type="button" className="inbox-open" onClick={() => props.onOpen(item)}>
                      <span className="inbox-title">{item.title}</span>
                      <span className="inbox-meta">
                        {item.kind === "turn" ? "Turn" : "Routine"} · {formatRelativeTime(item.createdAt)}
                      </span>
                      {item.body ? <span className="inbox-copy">{item.body}</span> : null}
                    </button>
                    <div className="inbox-actions">
                      {item.snoozeable ? (
                        <button type="button" className="btn btn-quiet" onClick={() => props.onSnooze(item)}>
                          Snooze
                        </button>
                      ) : null}
                      <button type="button" className="btn btn-quiet" onClick={() => props.onDismiss(item)}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function AgentHeading({
  agentName,
  count,
  onOpen,
}: {
  agentName: string;
  count: number;
  onOpen?: () => void;
}) {
  return (
    <div className="inbox-agent">
      <span>
        {agentName} · {count}
      </span>
      {onOpen ? (
        <button type="button" className="btn btn-quiet" onClick={onOpen}>
          Open
        </button>
      ) : null}
    </div>
  );
}

function WaitingCard({ row, ...props }: Props & { row: WaitingRow }) {
  let card: ReactNode;
  if (row.waitingKind === "approval") {
    card = (
      <ApprovalCard
        approval={row}
        busy={props.approvalBusyId === row.id}
        error={noticeFor(props.approvalError, row.id)}
        onDecide={(action) => props.onDecideApproval(row.id, action)}
      />
    );
  } else if (row.waitingKind === "question") {
    card = (
      <QuestionCard
        question={row}
        busy={props.questionBusyId === row.id}
        error={noticeFor(props.questionError, row.id)}
        onAnswer={(reply) => props.onAnswerQuestion(row.id, reply)}
      />
    );
  } else if (row.waitingKind === "handoff") {
    card = (
      <HandoffCard
        handoff={row}
        busy={props.handoffBusyId === row.id}
        error={noticeFor(props.handoffError, row.id)}
        onTakeover={() => props.onTakeoverHandoff(row.id)}
        onDone={() => props.onCompleteHandoff(row.id)}
      />
    );
  } else {
    card = (
      <SkillSaveCard
        request={row}
        busy={props.skillSaveBusyId === row.id}
        error={noticeFor(props.skillSaveError, row.id)}
        onDecide={(allow, draft) => props.onDecideSkillSave(row.id, allow, draft)}
      />
    );
  }
  return (
    <div className="inbox-card">
      <span className="inbox-since">Waiting {waitingLabel(row.createdAt)}</span>
      {card}
    </div>
  );
}

function RoutinesPane({ onOpenRoutines }: { onOpenRoutines: (agentId: string) => void }) {
  const [routines, setRoutines] = useState<RoutineOverview[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRoutines(await fid().routines.listAll());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load().catch((caught: unknown) => setError(errorText(caught)));
  }, [load]);

  async function act(routine: RoutineOverview, call: () => Promise<unknown>) {
    if (busyId) return;
    setBusyId(routine.id);
    setRowError(null);
    try {
      await call();
      await load();
    } catch (caught) {
      setRowError({ id: routine.id, text: errorText(caught) });
    } finally {
      setBusyId(null);
    }
  }

  function toggle(routine: RoutineOverview) {
    return act(routine, () => fid().routines.update(routine.id, { enabled: !routine.enabled }));
  }

  function runNow(routine: RoutineOverview) {
    return act(routine, () => fid().routines.run(routine.id));
  }

  if (error) {
    return (
      <p className="field-note" role="alert">
        {error}
      </p>
    );
  }
  if (!loaded) return <p className="field-note">Loading routines.</p>;
  if (routines.length === 0) return <p className="field-note">No routines yet.</p>;

  return (
    <div className="inbox-routine-list">
      {groupRoutineBoard(routines).map((group) => (
        <section className="inbox-agent-block" key={group.agentId} aria-label={`${group.agentName} routines`}>
          <AgentHeading agentName={group.agentName} count={group.count} />
          {group.items.map((routine) => {
            const next =
              !routine.once && routine.enabled && routine.nextRunAt ? formatNextRun(routine.nextRunAt) : "";
            const status = routine.lastStatus ? routineStatusLabel(routine.lastStatus) : "";
            return (
              <div className="inbox-routine" key={routine.id}>
                <div className="inbox-routine-copy">
                  <span className="inbox-title">{routine.name}</span>
                  <span className="inbox-meta">
                    {routineScheduleLabel(routine)}
                    {next ? ` · ${next}` : ""}
                    {routine.readOnly ? " · Look and report" : ""}
                    {status ? (
                      <>
                        {" · "}
                        <span className={routineStatusTone(routine.lastStatus)}>{status}</span>
                      </>
                    ) : null}
                  </span>
                  {!routine.enabled && routine.consecutiveFailures >= ROUTINE_FAILURE_LIMIT ? (
                    <span className="inbox-copy">
                      Paused after {ROUTINE_FAILURE_LIMIT} failures. Turn it on to try again.
                    </span>
                  ) : null}
                  {rowError?.id === routine.id ? (
                    <span className="inbox-copy" role="alert">
                      {rowError.text}
                    </span>
                  ) : null}
                </div>
                <Switch
                  checked={routine.enabled}
                  disabled={busyId === routine.id}
                  label={`Enabled: ${routine.name}`}
                  onChange={() => void toggle(routine)}
                />
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={busyId === routine.id || routine.lastStatus === "running"}
                  onClick={() => void runNow(routine)}
                >
                  Run now
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => onOpenRoutines(routine.agentId)}>
                  Open
                </button>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function waitingRows(props: Props): WaitingRow[] {
  return [
    ...props.approvals.map((request) => ({ ...request, waitingKind: "approval" as const })),
    ...props.questions.map((request) => ({ ...request, waitingKind: "question" as const })),
    ...props.handoffs.map((request) => ({ ...request, waitingKind: "handoff" as const })),
    ...props.skillSaves.map((request) => ({ ...request, waitingKind: "skill-save" as const })),
  ];
}

function noticeFor(notice: Notice, id: string): string | null {
  return notice?.id === id ? notice.text : null;
}

function waitingLabel(iso: string): string {
  const value = formatRelativeTime(iso);
  if (!value) return "";
  if (value === "now") return "just now";
  return /^\d+[mhd]$/.test(value) ? `${value} ago` : `since ${value}`;
}
