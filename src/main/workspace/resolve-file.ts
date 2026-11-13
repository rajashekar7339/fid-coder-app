import fs from "fs";
import path from "path";
import { SKIP_DIR_NAMES, relativeInside, resolveInside } from "../../tools/workspace";

const MAX_WALK_ENTRIES = 20_000;
const INDEX_TTL_MS = 3_000;

export type WorkspaceFileResolution = {
  file: string;
  relative: string;
};

type FileIndex = {
  root: string;
  files: string[];
  complete: boolean;
  at: number;
};

let cachedIndex: FileIndex | null = null;

/**
 * Resolves a workspace path. An exact relative path wins. When it does not
 * exist, a bare or partial name is matched against the workspace by its path
 * suffix, so a citation such as `Test.java:123` can find `src/java/Test.java`.
 * The name must identify exactly one file.
 */
export function resolveWorkspaceFile(
  workspaceDir: string,
  requested: string,
): WorkspaceFileResolution {
  const cleaned = requested.trim();
  if (!cleaned) throw new Error("Choose a file to open");
  const exact = resolveInside(workspaceDir, cleaned);
  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(exact);
  } catch {
    stat = null;
  }
  if (stat) {
    if (!stat.isFile()) throw new Error("That path is not a file");
    return { file: exact, relative: relativeInside(workspaceDir, exact) };
  }

  const wanted = comparePath(cleaned);
  let index = workspaceFiles(workspaceDir);
  let matches = matchFiles(index.files, wanted);
  if (matches.length === 0) {
    // A turn may have created the file after this index was built.
    cachedIndex = null;
    index = workspaceFiles(workspaceDir);
    matches = matchFiles(index.files, wanted);
  }
  if (matches.length === 1) {
    const relative = matches[0]!;
    return { file: path.resolve(workspaceDir, relative), relative };
  }
  if (matches.length === 0) {
    if (!index.complete) {
      throw new Error("That file name could not be resolved in this large workspace. Use a fuller path.");
    }
    throw new Error("That file was not found");
  }
  const shown = matches.slice(0, 5).join(", ");
  const more = matches.length > 5 ? ` and ${matches.length - 5} more` : "";
  throw new Error(`That file name is ambiguous: ${shown}${more}. Use a fuller path.`);
}

function workspaceFiles(root: string): FileIndex {
  const now = Date.now();
  if (cachedIndex && cachedIndex.root === root && now - cachedIndex.at < INDEX_TTL_MS) {
    return cachedIndex;
  }
  const files: string[] = [];
  const stack = [root];
  let visited = 0;
  let complete = true;
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_WALK_ENTRIES) {
        complete = false;
        break;
      }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        files.push(relativeInside(root, full));
      }
    }
    if (!complete) break;
  }
  cachedIndex = { root, files, complete, at: now };
  return cachedIndex;
}

function matchFiles(files: string[], wanted: string): string[] {
  return files.filter((relative) => {
    const actual = comparePath(relative);
    return actual === wanted || actual.endsWith(`/${wanted}`);
  });
}

function comparePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}
