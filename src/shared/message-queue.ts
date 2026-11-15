export const QUEUE_LIMIT = 20;

/** A queue entry needs text or an attachment, and the queue has a cap. */
export function queueProblem(
  text: string,
  attachmentCount: number,
  queued: number,
): string | null {
  if (!text.trim() && attachmentCount === 0) return "Message is empty";
  if (queued >= QUEUE_LIMIT) {
    return `The queue is full (${QUEUE_LIMIT} messages). Send one before adding another.`;
  }
  return null;
}
