import { parseExpression } from "cron-parser";
import { validate } from "node-cron";

export function assertCron(expression: string): string {
  const trimmed = expression.trim();
  if (!validate(trimmed)) {
    throw new Error("Cron must be a 5-field expression, for example 0 9 * * 1-5");
  }
  return trimmed;
}

export function nextRunIso(expression: string): string | null {
  try {
    return parseExpression(expression).next().toDate().toISOString();
  } catch {
    return null;
  }
}
