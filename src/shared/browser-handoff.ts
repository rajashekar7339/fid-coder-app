export const BROWSER_HANDOFF_TOOL = "browser_needs_you";
export const HANDOFF_TIMEOUT_MS = 10 * 60 * 1000;
export const HANDOFF_REASON_MAX = 200;

export const HANDOFF_HINT =
  "When a page needs the user to sign in or solve a captcha, call browser_needs_you once and wait. Do not ask for or type a password. After the user hands the browser back, call browser_snapshot before the next click, type, or navigation.";

export const BROWSER_HELD_TEXT =
  "The browser is waiting for you. Finish sign-in and choose Done before the next browser action.";

export const NEED_SNAPSHOT_TEXT =
  "Take a fresh browser_snapshot before the next click, type, or navigation.";

export const HANDOFF_DONE_TEXT =
  "The user handed the browser back. Take a fresh browser_snapshot before the next click, type, or navigation. Do not ask for or type a password.";

export const HANDOFF_TIMEOUT_TEXT =
  "The user did not finish in the browser. Do not type a password. Take a fresh browser_snapshot before the next click, type, or navigation.";

export const HANDOFF_CLOSED_TEXT = "The browser closed before you handed it back.";

export function browserActError(state: { held: boolean; needsSnapshot: boolean }): string | null {
  if (state.held) return BROWSER_HELD_TEXT;
  if (state.needsSnapshot) return NEED_SNAPSHOT_TEXT;
  return null;
}

export function parseHandoffReason(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object");
  }
  const reason = (args as Record<string, unknown>).reason;
  if (typeof reason !== "string" || !reason.trim()) throw new Error("Missing reason");
  const clean = reason.trim().replace(/\s+/g, " ");
  if (clean.length > HANDOFF_REASON_MAX) throw new Error("Reason is too long");
  return clean;
}
