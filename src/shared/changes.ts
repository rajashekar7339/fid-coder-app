import type { ChangeSet, FileChangeMatch } from "./types";

/** Matches findChangedFile with citation paths, which may be bare names. */
function comparePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

export function changeTotals(change: ChangeSet | null): { additions: number; deletions: number } {
  if (!change) return { additions: 0, deletions: 0 };
  return change.files.reduce(
    (total, file) => ({
      additions: total.additions + file.additions,
      deletions: total.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

export function changeFileCount(change: ChangeSet | null): number {
  return change?.files.length ?? 0;
}

export function findChangedFile(changeSets: ChangeSet[], path: string): FileChangeMatch | null {
  const requested = comparePath(path);
  if (!requested) return null;
  let exact: FileChangeMatch | null = null;
  const suffix = new Map<string, FileChangeMatch>();
  for (const change of changeSets) {
    for (const file of change.files) {
      const actual = comparePath(file.path);
      if (actual === requested) {
        if (!exact) exact = { turnId: change.turnId, file };
        continue;
      }
      if (!actual.endsWith(`/${requested}`)) continue;
      if (!suffix.has(actual)) suffix.set(actual, { turnId: change.turnId, file });
    }
  }
  if (exact) return exact;
  return suffix.size === 1 ? [...suffix.values()][0]! : null;
}
