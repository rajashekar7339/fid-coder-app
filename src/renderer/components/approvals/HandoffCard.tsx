import { LogIn } from "lucide-react";
import type { BrowserHandoffRequest } from "../../../shared/types";
import { useCountdown } from "../../lib/countdown";
import { Switch } from "../ui/Switch";
import { CardHeader } from "./CardHeader";

type Props = {
  handoff: BrowserHandoffRequest;
  busy: boolean;
  error: string | null;
  onTakeover: () => void;
  onDone: () => void;
};

export function HandoffCard({ handoff, busy, error, onTakeover, onDone }: Props) {
  const seconds = useCountdown(handoff.expiresAt);

  return (
    <section className="question-card" aria-label="Needs you">
      <CardHeader
        icon={<LogIn size={14} aria-hidden="true" />}
        kicker="Needs you"
        seconds={seconds}
        urgentAt={60}
        countdownLabel="Continues without you"
      >
        <p className="question-text">{handoff.reason}</p>
      </CardHeader>

      <label className="handoff-switch">
        <Switch
          checked={handoff.takenOver}
          disabled={busy || handoff.takenOver}
          label="I have the browser"
          onChange={(checked) => {
            if (checked) onTakeover();
          }}
        />
        <span>I have the browser</span>
      </label>

      {error ? (
        <p className="question-error" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="question-card-actions">
        <span className="footer-spacer" />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onDone}>
          Done
        </button>
      </footer>
    </section>
  );
}
