export type UsageLevel = "ok" | "low" | "critical";

// The bar fills with quota used, so a high percentage is the warning state.
export function usageLevel(percent: number | null, blocked = false): UsageLevel {
  if (blocked || (percent !== null && percent > 90)) return "critical";
  if (percent !== null && percent > 70) return "low";
  return "ok";
}

type Props = {
  percent: number | null;
  blocked?: boolean;
  label: string;
  title?: string;
  className?: string;
};

export function UsageBar({ percent, blocked = false, label, title, className }: Props) {
  const level = usageLevel(percent, blocked);
  const value = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  const classes = ["usage-bar", level === "ok" ? "" : `is-${level}`, className ?? ""].filter(Boolean).join(" ");
  return (
    <span
      className={classes}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      title={title}
    >
      <span className="usage-fill" style={{ width: `${value}%` }} />
    </span>
  );
}
