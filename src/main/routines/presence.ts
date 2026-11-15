import { parsePresencePatch, readAppPresence, type AppPresence } from "../../shared/app-settings";
import type { AppDatabase } from "../db";

export function appPresence(db: AppDatabase): AppPresence {
  return readAppPresence((key) => db.getSetting(key));
}

export function saveAppPresence(
  db: AppDatabase,
  value: unknown,
  setPaused: (paused: boolean) => void,
): AppPresence {
  const patch = parsePresencePatch(value);
  if (typeof patch.routinesPaused === "boolean") setPaused(patch.routinesPaused);
  return appPresence(db);
}
