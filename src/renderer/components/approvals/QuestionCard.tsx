import { useEffect, useState } from "react";
import { CircleHelp, Clock3 } from "lucide-react";
import { OTHER_MAX_LENGTH } from "../../../shared/question";
import type { QuestionReply, QuestionRequest } from "../../../shared/types";

type Props = {
  question: QuestionRequest;
  busy: boolean;
  error: string | null;
  onAnswer: (reply: QuestionReply) => void;
};

export function QuestionCard({ question, busy, error, onAnswer }: Props) {
  const [seconds, setSeconds] = useState(() => secondsLeft(question.expiresAt));
  const [other, setOther] = useState("");

  useEffect(() => {
    setSeconds(secondsLeft(question.expiresAt));
    setOther("");
    const timer = window.setInterval(() => setSeconds(secondsLeft(question.expiresAt)), 1000);
    return () => window.clearInterval(timer);
  }, [question.expiresAt, question.id]);

  const ownAnswer = other.trim();

  return (
    <section className="question-card" aria-label="Question">
      <div className="question-card-main">
        <span className="question-card-icon">
          <CircleHelp size={14} aria-hidden="true" />
        </span>
        <div className="question-card-copy">
          <div className="question-card-line">
            <span className="question-kicker">Question</span>
            <span
              className={seconds <= 20 ? "question-countdown is-urgent" : "question-countdown"}
              aria-live="off"
              title={`Continues with no answer in ${formatSeconds(seconds)}`}
            >
              <Clock3 size={10} aria-hidden="true" />
              {formatSeconds(seconds)}
            </span>
          </div>
          <p className="question-text">{question.question}</p>
        </div>
      </div>

      <div className="question-choices">
        {question.choices.map((choice, index) => (
          <button
            key={choice}
            type="button"
            className="btn btn-secondary question-choice"
            disabled={busy}
            onClick={() => onAnswer({ kind: "choice", index })}
          >
            {choice}
          </button>
        ))}
      </div>

      <form
        className="question-other"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ownAnswer || busy) return;
          onAnswer({ kind: "other", text: ownAnswer });
        }}
      >
        <input
          className="question-other-input"
          value={other}
          maxLength={OTHER_MAX_LENGTH}
          placeholder="Or type your own answer"
          aria-label="Your own answer"
          disabled={busy}
          onChange={(event) => setOther(event.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !ownAnswer}>
          Answer
        </button>
      </form>

      {error ? (
        <p className="question-error" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="question-card-actions">
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          title="Continue without an answer"
          onClick={() => onAnswer({ kind: "skip" })}
        >
          Skip
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
