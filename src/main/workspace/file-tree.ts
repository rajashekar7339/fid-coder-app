import fs from "fs";
import path from "path";
import { SKIP_DIR_NAMES, relativeInside, resolveInside } from "../../tools/workspace";
import type { WorkspaceDirectory, WorkspaceEntry } from "../../shared/types";

export const MAX_DIRECTORY_ENTRIES = 400;

export async function listWorkspaceDirectory(
  workspaceDir: string,
  requested = "",
): Promise<WorkspaceDirectory> {
  const dir = resolveInside(workspaceDir, requested);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(dir);
  } catch {
    throw new Error("That folder was not found");
  }
  if (!stat.isDirectory()) throw new Error("That path is not a folder");

  const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
  const rows: WorkspaceEntry[] = [];
  for (const entry of dirents) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      rows.push({
        name: entry.name,
        path: relativeInside(workspaceDir, path.join(dir, entry.name)),
        kind: "dir",
      });
      continue;
    }
    if (entry.isFile()) {
      rows.push({
        name: entry.name,
        path: relativeInside(workspaceDir, path.join(dir, entry.name)),
        kind: "file",
      });
    }
  }

  rows.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

  return {
    entries: rows.slice(0, MAX_DIRECTORY_ENTRIES),
    truncated: rows.length > MAX_DIRECTORY_ENTRIES,
  };
}
