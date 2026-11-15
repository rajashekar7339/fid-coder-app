import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import {
  SKILL_DRAFT_DESCRIPTION_MAX,
  SKILL_NAME_MAX,
  SKILL_STEPS_MAX,
  type SkillDraftInput,
} from "../../../shared/skill-draft";
import type { SkillSaveRequest } from "../../../shared/types";
import { useCountdown } from "../../lib/countdown";
import { CardHeader } from "./CardHeader";

type Props = {
  request: SkillSaveRequest;
  busy: boolean;
  error: string | null;
  onDecide: (allow: boolean, draft?: SkillDraftInput) => void;
};

export function SkillSaveCard({ request, busy, error, onDecide }: Props) {
  const seconds = useCountdown(request.expiresAt);
  const [name, setName] = useState(request.name);
  const [description, setDescription] = useState(request.description);
  const [steps, setSteps] = useState(request.steps);

  useEffect(() => {
    setName(request.name);
    setDescription(request.description);
    setSteps(request.steps);
  }, [request.id, request.name, request.description, request.steps]);

  const ready = Boolean(name.trim() && description.trim() && steps.trim());
  const nameChanged = name.trim() !== request.name;

  return (
    <section className="question-card" aria-label="Save skill">
      <CardHeader
        icon={<Save size={14} aria-hidden="true" />}
        kicker="Save skill"
        seconds={seconds}
        urgentAt={20}
        countdownLabel="Closes without saving"
      />

      <div className="skill-save-fields">
        <label className="skill-save-field">
          <span>Name</span>
          <input
            className="skill-save-input"
            value={name}
            maxLength={SKILL_NAME_MAX}
            disabled={busy}
            aria-label="Skill name"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="skill-save-field">
          <span>When to use</span>
          <textarea
            className="skill-save-input skill-save-description-input"
            value={description}
            maxLength={SKILL_DRAFT_DESCRIPTION_MAX}
            rows={2}
            disabled={busy}
            aria-label="Skill description"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="skill-save-field">
          <span>Steps and checks</span>
          <textarea
            className="skill-save-input skill-save-steps-input"
            value={steps}
            maxLength={SKILL_STEPS_MAX}
            rows={6}
            disabled={busy}
            aria-label="Skill steps"
            onChange={(event) => setSteps(event.target.value)}
          />
        </label>
      </div>

      {request.replaces && !nameChanged ? (
        <p className="skill-save-replaces">Replaces installed skill {request.skillId}</p>
      ) : null}

      {error ? (
        <p className="question-error" role="alert">
          {error}
        </p>
      ) : null}

      <footer className="question-card-actions">
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => onDecide(false)}>
          Don't save
        </button>
        <span className="footer-spacer" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !ready}
          onClick={() =>
            onDecide(true, {
              name: name.trim(),
              description: description.trim(),
              steps: steps.trim(),
            })
          }
        >
          Save
        </button>
      </footer>
    </section>
  );
}
