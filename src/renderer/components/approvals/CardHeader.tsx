import type { ReactNode } from "react";
import { Clock3 } from "lucide-react";
import { formatSeconds } from "../../lib/countdown";

type Props = {
  icon: ReactNode;
  kicker: string;
  seconds: number;
  urgentAt: number;
  countdownLabel: string;
  children?: ReactNode;
};

export function CardHeader({ icon, kicker, seconds, urgentAt, countdownLabel, children }: Props) {
  return (
    <div className="question-card-main">
      <span className="question-card-icon">{icon}</span>
      <div className="question-card-copy">
        <div className="question-card-line">
          <span className="question-kicker">{kicker}</span>
          <span
            className={seconds <= urgentAt ? "question-countdown is-urgent" : "question-countdown"}
            aria-live="off"
            title={`${countdownLabel} in ${formatSeconds(seconds)}`}
          >
            <Clock3 size={10} aria-hidden="true" />
            {formatSeconds(seconds)}
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
