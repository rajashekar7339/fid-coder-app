import { useEffect, useState } from "react";
import { CircleHelp } from "lucide-react";
import { OTHER_MAX_LENGTH } from "../../../shared/question";
import type { QuestionReply, QuestionRequest } from "../../../shared/types";
import { useCountdown } from "../../lib/countdown";
import { CardHeader } from "./CardHeader";

type Props = {
  question: QuestionRequest;
  busy: boolean;
  error: string | null;
  onAnswer: (reply: QuestionReply) => void;
};

export function QuestionCard({ question, busy, error, onAnswer }: Props) {
  const seconds = useCountdown(question.expiresAt);
  const [other, setOther] = useState("");

  useEffect(() => setOther(""), [question.id]);

  const ownAnswer = other.trim();

  return (
    <section className="question-card" aria-label="Question">
      <CardHeader
        icon={<CircleHelp size={14} aria-hidden="true" />}
        kicker="Question"
        seconds={seconds}
        urgentAt={20}
        countdownLabel="Continues with no answer"
      >
        <p className="question-text">{question.question}</p>
      </CardHeader>

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
