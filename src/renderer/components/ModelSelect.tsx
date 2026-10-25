import { AUTO_MODEL_ID } from "../../shared/model";
import type { CopilotModel } from "../../shared/types";

type Props = {
  id?: string;
  value: string;
  models: CopilotModel[];
  disabled?: boolean;
  className?: string;
  onChange: (model: string) => void;
};

export function ModelSelect({ id, value, models, disabled, className, onChange }: Props) {
  const known = value === AUTO_MODEL_ID || models.some((model) => model.id === value);
  return (
    <select
      id={id}
      className={className ?? "w-full rounded-xl border border-border bg-card px-3 py-2 text-[14px] outline-none focus:border-input"}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value={AUTO_MODEL_ID}>Auto</option>
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.name}
        </option>
      ))}
      {!known ? <option value={value}>{value}</option> : null}
    </select>
  );
}
