import type { AttachmentKind, MessageAttachment } from "./types";

export const MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_SELECTION_CHARS = 200_000;
export const ATTACHMENT_ONLY_MESSAGE = "Review the attached content.";

const ATTACHMENT_KINDS: AttachmentKind[] = ["selection", "workspace", "upload"];

export function attachmentLabel(attachment: MessageAttachment): string {
  if (attachment.kind === "selection" && attachment.startLine !== undefined) {
    const end = attachment.endLine ?? attachment.startLine;
    return `${attachment.name}:${attachment.startLine}${end === attachment.startLine ? "" : `–${end}`}`;
  }
  return attachment.name;
}

export function attachmentKey(attachment: MessageAttachment): string {
  return [
    attachment.kind,
    attachment.path.replace(/\\/g, "/"),
    attachment.startLine ?? 0,
    attachment.endLine ?? 0,
  ].join(":");
}

export function attachmentsForSend(
  pinned: MessageAttachment[],
  active: MessageAttachment | null,
): MessageAttachment[] {
  if (!active) return pinned;
  const key = attachmentKey(active);
  return pinned.some((attachment) => attachmentKey(attachment) === key)
    ? pinned
    : [...pinned, active];
}

export function addAttachments(
  current: MessageAttachment[],
  incoming: MessageAttachment[],
): MessageAttachment[] {
  const next = current.slice();
  for (const attachment of incoming) {
    const key = attachmentKey(attachment);
    const existing = next.findIndex((item) => attachmentKey(item) === key);
    if (existing >= 0) {
      next[existing] = attachment;
      continue;
    }
    next.push(attachment);
  }
  return next;
}

export function normalizeLineRange(
  startLine: number | null | undefined,
  endLine: number | null | undefined,
  totalLines: number,
): { startLine: number; endLine: number } | null {
  if (totalLines <= 0) return null;
  const start = clampLine(startLine ?? 1, totalLines);
  const end = clampLine(endLine ?? start, totalLines);
  return {
    startLine: Math.min(start, end),
    endLine: Math.max(start, end),
  };
}

export function parseMessageAttachments(raw: string | null): MessageAttachment[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return null;
    const attachments = value.filter(isMessageAttachment);
    return attachments.length > 0 ? attachments : null;
  } catch {
    return null;
  }
}

function clampLine(value: number, totalLines: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(totalLines, Math.max(1, Math.floor(value)));
}

function isMessageAttachment(value: unknown): value is MessageAttachment {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MessageAttachment>;
  if (!ATTACHMENT_KINDS.includes(item.kind as AttachmentKind)) return false;
  if (typeof item.path !== "string" || !item.path.trim()) return false;
  if (typeof item.name !== "string" || !item.name.trim()) return false;
  if (item.startLine !== undefined && !Number.isFinite(item.startLine)) return false;
  if (item.endLine !== undefined && !Number.isFinite(item.endLine)) return false;
  return true;
}
