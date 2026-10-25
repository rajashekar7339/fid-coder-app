export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object");
  }
  return value as Record<string, unknown>;
}

export function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${key}`);
  }
  return value.trim();
}

export function optionalString(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  const trimmed = value.trim();
  return trimmed || null;
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (value == null) return false;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

export function optionalNumber(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key];
  if (value == null || value === "") return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a number`);
  return value;
}
