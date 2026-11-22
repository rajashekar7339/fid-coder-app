import { ChevronDown, Sparkles } from "lucide-react";
import { AUTO_MODEL_ID } from "../../../shared/model";
import type { CopilotModel } from "../../../shared/types";

type Props = {
  id?: string;
  value: string;
  models: CopilotModel[];
  disabled?: boolean;
  className?: string;
  label?: string;
  allowAuto?: boolean;
  onChange: (model: string) => void;
};

export function ModelSelect({
  id,
  value,
  models,
  disabled,
  className,
  label = "Agent model",
  allowAuto = true,
  onChange,
}: Props) {
  const known = (allowAuto && value === AUTO_MODEL_ID) || models.some((model) => model.id === value);
  const selectedLabel =
    allowAuto && value === AUTO_MODEL_ID
      ? "Auto"
      : (models.find((model) => model.id === value)?.name ?? value);
  return (
    <span className={`model-picker ${className ?? ""}`}>
      <Sparkles size={12} aria-hidden="true" />
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-label={label}
        title={selectedLabel}
        onChange={(event) => onChange(event.target.value)}
      >
        {allowAuto ? <option value={AUTO_MODEL_ID}>Auto</option> : null}
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
        {!known ? <option value={value}>{value}</option> : null}
      </select>
      <ChevronDown size={11} aria-hidden="true" />
    </span>
  );
}
