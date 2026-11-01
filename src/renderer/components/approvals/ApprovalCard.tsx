import { useEffect, useState } from "react";
import { Check, Clock3, ShieldAlert } from "lucide-react";
import type { ApprovalAction, ApprovalRequest } from "../../../shared/types";

type Props = {
  approval: ApprovalRequest;
  busy: boolean;
  error: string | null;
  onDecide: (action: ApprovalAction) => void;
};

export function ApprovalCard({ approval, busy, error, onDecide }: Props) {
  const [seconds, setSeconds] = useState(() => secondsLeft(approval.expiresAt));

  useEffect(() => {
    setSeconds(secondsLeft(approval.expiresAt));
    const timer = window.setInterval(() => setSeconds(secondsLeft(approval.expiresAt)), 1000);
    return () => window.clearInterval(timer);
  }, [approval.expiresAt, approval.id]);

  return (
    <section className="approval-card" aria-label="Approval needed">
      <div className="approval-card-main">
        <span className="approval-card-icon">
          <ShieldAlert size={14} aria-hidden="true" />
        </span>
        <div className="approval-card-copy">
          <div className="approval-card-line">
            <span className="approval-kicker">Approval needed</span>
            <span
              className={seconds <= 20 ? "approval-countdown is-urgent" : "approval-countdown"}
              aria-live="off"
              title={`Auto-denies in ${formatSeconds(seconds)}`}
            >
              <Clock3 size={10} aria-hidden="true" />
              {formatSeconds(seconds)}
            </span>
          </div>
          <code className="approval-card-command" title={approval.command}>
            {approval.command}
          </code>
          <span className="approval-card-meta" title={`${approval.cwd} — ${approval.reason}`}>
            {approval.cwd} · {approval.reason}
          </span>
        </div>
      </div>

      {error ? (
        <p className="approval-error" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="approval-card-actions">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => onDecide("reject")}>
          Reject
        </button>
        <button
          type="button"
          className="btn btn-danger-outline"
          disabled={busy}
          title="Save a deny rule for this exact command and folder"
          onClick={() => onDecide("always-deny")}
        >
          Always deny
        </button>
        <span className="footer-spacer" />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          title="Save an allow rule for this exact command and folder"
          onClick={() => onDecide("always-allow")}
        >
          Always allow
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onDecide("approve")}>
          <Check size={12} aria-hidden="true" />
          Allow once
        </button>
      </footer>
    </section>
  );
}

function secondsLeft(iso: string): number {
  const expires = Date.parse(iso);
  if (!Number.isFinite(expires)) return 0;
  return Math.max(0, Math.ceil((expires - Date.now()) / 1000));
}

function formatSeconds(seconds: number): string {
  return seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "now";
}
