import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { approvalRecordLabel } from "../../../shared/approval";
import type { Agent, ApprovalRecord } from "../../../shared/types";
import { errorText, fid } from "../../lib/fid";
import { formatRelativeTime } from "../../lib/format";
import { Modal } from "../ui/Modal";

type Props = {
  agent: Agent;
  onClose: () => void;
};

export function ApprovalHistoryDialog({ agent, onClose }: Props) {
  const [records, setRecords] = useState<ApprovalRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fid()
      .approvals.history(agent.id, 100)
      .then((list) => {
        if (!cancelled) setRecords(list);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorText(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  return (
    <Modal label={`Approval history for ${agent.name}`} className="approval-history-modal" onClose={onClose}>
      <header className="modal-header">
        <div className="modal-head-copy">
          <div className="modal-kicker">Approval history</div>
          <div className="modal-title">{agent.name}</div>
        </div>
        <button type="button" className="icon-button" aria-label="Close approval history" onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="approval-history-body">
        {loading ? (
          <p className="approval-history-empty">Reading history…</p>
        ) : error ? (
          <p className="approval-history-error" role="alert">
            {error}
          </p>
        ) : records.length === 0 ? (
          <p className="approval-history-empty">No approval requests yet.</p>
        ) : (
          <div className="approval-history-list">
            {records.map((record) => (
              <div className="approval-history-row" key={record.id}>
                <span className={`approval-decision is-${record.decision}`}>{approvalRecordLabel(record)}</span>
                <div className="approval-history-copy">
                  <code>{record.command}</code>
                  <span>{record.cwd}</span>
                  <span>{record.reason}</span>
                </div>
                <div className="approval-history-side">
                  <span>{formatRelativeTime(record.decidedAt ?? record.createdAt)}</span>
                  <span>{record.turnId ? `Turn ${record.turnId.slice(0, 8)}` : "Chat"}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

