import type { ChangeSet, FileChangeMatch } from "./types";

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
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const change of changeSets) {
    const file = change.files.find(
      (item) => item.path.replace(/\\/g, "/").replace(/^\.\//, "") === normalized,
    );
    if (file) return { turnId: change.turnId, file };
  }
  return null;
}
