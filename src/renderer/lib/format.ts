const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
const DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

function asDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatClock(iso: string | null | undefined): string {
  const date = asDate(iso);
  return date ? date.toLocaleTimeString(undefined, TIME) : "";
}

export function formatDay(iso: string | null | undefined): string {
  const date = asDate(iso);
  if (!date) return "";
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, now)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    ...DAY,
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function formatRelativeTime(iso: string | null | undefined): string {
  const date = asDate(iso);
  if (!date) return "";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, DAY);
}

export function formatNextRun(iso: string | null | undefined): string {
  const date = asDate(iso);
  if (!date) return "";
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const label = sameDay(date, now)
    ? "Today"
    : sameDay(date, tomorrow)
      ? "Tomorrow"
      : date.toLocaleDateString(undefined, { weekday: "short", ...DAY });
  return `${label}, ${formatClock(iso)}`;
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
