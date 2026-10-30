import { useState } from "react";
import { Check, ChevronDown, Circle, ListChecks, Loader2 } from "lucide-react";
import type { PlanStep } from "../../../shared/types";

type Props = {
  steps: PlanStep[];
  running: boolean;
};

export function PlanStrip({ steps, running }: Props) {
  const [open, setOpen] = useState(false);
  if (steps.length === 0) return null;
  const done = steps.filter((step) => step.status === "done").length;
  const active = steps.find((step) => step.status === "in_progress") ?? steps.find((step) => step.status === "pending");
  const summary = active?.text ?? (done === steps.length ? "All steps done" : "Waiting for the next step");

  return (
    <div className={`plan-strip ${running ? "is-running" : ""}`}>
      <button type="button" className="plan-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <ListChecks size={12} aria-hidden="true" />
        <span className="plan-title">Plan</span>
        <span className="plan-count">
          {done}/{steps.length}
        </span>
        <span className="plan-current">{summary}</span>
        <ChevronDown size={12} className={`plan-chevron ${open ? "is-open" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <ol className="plan-steps">
          {steps.map((step, index) => (
            <li key={`${index}-${step.text}`} className={`plan-step is-${step.status}`}>
              <span className="plan-mark" aria-hidden="true">
                {step.status === "done" ? (
                  <Check size={11} />
                ) : step.status === "in_progress" ? (
                  <Loader2 size={11} className="spin" />
                ) : (
                  <Circle size={8} />
                )}
              </span>
              <span className="plan-step-text">{step.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
