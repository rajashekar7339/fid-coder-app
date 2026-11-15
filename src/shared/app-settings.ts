export const SETTING_ROUTINES_PAUSED = "routines_paused";

export type AppPresence = {
  routinesPaused: boolean;
};

export function readAppPresence(get: (key: string) => string | null): AppPresence {
  return {
    routinesPaused: get(SETTING_ROUTINES_PAUSED) === "1",
  };
}

export function parsePresencePatch(value: unknown): Partial<AppPresence> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const patch: Partial<AppPresence> = {};
  if (typeof record.routinesPaused === "boolean") patch.routinesPaused = record.routinesPaused;
  return patch;
}
