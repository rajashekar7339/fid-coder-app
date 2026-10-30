export const COPILOT_USAGE_REFRESH_MS = 5 * 60 * 1000;

export const COPILOT_USAGE_UNAVAILABLE = "Usage is not available from this Copilot CLI.";

export type CopilotUsageView = {
  label: string;
  unlimited: boolean;
  used: number;
  included: number | null;
  remaining: number | null;
  remainingPercent: number | null;
  overage: number;
  resetsAt: string | null;
  blocked: boolean;
};

export type CopilotUsageResult = {
  usage: CopilotUsageView | null;
  message: string | null;
};

const PREFERRED_KEYS = new Set(["premium_interactions", "premiumInteractions"]);

const LABELS: Record<string, string> = {
  premium_interactions: "Premium requests",
  premiumInteractions: "Premium requests",
  chat: "Chat",
  completions: "Completions",
};

const SECRET = /ghp_|github_pat_|gho_|ghu_|eyJ/;

export function normalizeCopilotUsage(snapshots: unknown): CopilotUsageView | null {
  if (!isRecord(snapshots)) return null;
  const parsed: Array<{ key: string; view: CopilotUsageView }> = [];
  for (const [key, value] of Object.entries(snapshots)) {
    if (!isRecord(value)) continue;
    const view = toView(key, value);
    if (view) parsed.push({ key, view });
  }
  if (parsed.length === 0) return null;
  const preferred = parsed.find((item) => PREFERRED_KEYS.has(item.key));
  if (preferred) return preferred.view;
  const finite = parsed.find((item) => !item.view.unlimited);
  return (finite ?? parsed[0])?.view ?? null;
}

export function formatUsageCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = roundUsage(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatUsageReset(value: string | null | undefined, locale = "en-GB"): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
  }
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function usageFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (SECRET.test(raw)) return "Copilot usage could not be read.";
  if (/method not found|unknown method|-32601/i.test(raw)) return COPILOT_USAGE_UNAVAILABLE;
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > 160) return "Copilot usage could not be read.";
  return cleaned;
}

function toView(key: string, record: Record<string, unknown>): CopilotUsageView | null {
  const unlimitedFlag = snapshotFlag(record, "isUnlimitedEntitlement", "is_unlimited_entitlement", "unlimited");
  const entitlement = snapshotNumber(record, "entitlementRequests", "entitlement");
  const usedRaw = snapshotNumber(record, "usedRequests", "used");
  if (unlimitedFlag === null && entitlement === null && usedRaw === null) return null;

  const unlimited = unlimitedFlag === true || (entitlement !== null && entitlement < 0);
  const included = unlimited || entitlement === null || entitlement < 0 ? null : roundUsage(entitlement);
  const used = roundUsage(Math.max(0, usedRaw ?? 0));
  const remaining =
    included === null || entitlement === null || entitlement < 0
      ? null
      : roundUsage(Math.max(0, entitlement - (usedRaw ?? 0)));
  const overage = roundUsage(Math.max(0, snapshotNumber(record, "overage", "overage_count") ?? 0));
  const reportedPercent = snapshotNumber(record, "remainingPercentage", "percent_remaining", "percentRemaining");
  let remainingPercent: number | null = null;
  if (!unlimited && reportedPercent !== null) {
    remainingPercent = roundUsage(Math.min(100, Math.max(0, reportedPercent)));
  } else if (!unlimited && included !== null && included > 0 && remaining !== null) {
    remainingPercent = roundUsage((remaining / included) * 100);
  } else if (!unlimited && included === 0) {
    remainingPercent = 0;
  }

  const allowed = snapshotFlag(record, "usageAllowedWithExhaustedQuota", "usage_allowed_with_exhausted_quota");
  return {
    label: usageLabel(key),
    unlimited,
    used,
    included,
    remaining,
    remainingPercent,
    overage,
    resetsAt: readReset(record),
    blocked: !unlimited && remaining === 0 && allowed === false,
  };
}

function usageLabel(key: string): string {
  const known = LABELS[key];
  if (known) return known;
  const words = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!words) return "Copilot usage";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function readReset(record: Record<string, unknown>): string | null {
  const value = record.resetDate ?? record.reset_date ?? record.quota_reset_at;
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const date = new Date(trimmed);
  return Number.isFinite(date.getTime()) ? trimmed : null;
}

function snapshotFlag(record: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function snapshotNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function roundUsage(value: number): number {
  return Math.round(value * 10) / 10;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
