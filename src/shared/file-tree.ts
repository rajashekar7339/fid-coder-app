type FileTreeFolder = {
  kind: "folder";
  name: string;
  path: string;
  children: FileTreeNode[];
};

type FileTreeFile = {
  kind: "file";
  name: string;
  path: string;
};

export type FileTreeNode = FileTreeFolder | FileTreeFile;

type FolderBuilder = {
  name: string;
  path: string;
  folders: Map<string, FolderBuilder>;
  files: string[];
};

export function normalizeWorkspacePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/**
 * True when a full workspace path names the requested file. A citation may
 * carry only a file name or a partial path, so a path suffix counts. The
 * match is case-insensitive on Windows paths.
 */
export function workspacePathMatches(actual: string, requested: string): boolean {
  const left = normalizeWorkspacePath(actual).toLowerCase();
  const right = normalizeWorkspacePath(requested).toLowerCase();
  if (!left || !right) return false;
  return left === right || left.endsWith(`/${right}`);
}

function baseName(path: string): string {
  return path.split("/").pop() || path;
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

export function buildPathTree(paths: string[]): FileTreeNode[] {
  const root: FolderBuilder = { name: "", path: "", folders: new Map(), files: [] };
  const seen = new Set<string>();
  for (const raw of paths) {
    const path = normalizeWorkspacePath(raw);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const folderPath = folder.path ? `${folder.path}/${part}` : part;
      let child = folder.folders.get(part);
      if (!child) {
        child = { name: part, path: folderPath, folders: new Map(), files: [] };
        folder.folders.set(part, child);
      }
      folder = child;
    }
    folder.files.push(path);
  }

  const toNodes = (folder: FolderBuilder): FileTreeNode[] => {
    const folders = [...folder.folders.values()]
      .sort((left, right) => compareNames(left.name, right.name))
      .map((child): FileTreeFolder => ({
        kind: "folder",
        name: child.name,
        path: child.path,
        children: toNodes(child),
      }));
    const files = [...folder.files]
      .sort((left, right) => compareNames(baseName(left), baseName(right)))
      .map((path): FileTreeFile => ({
        kind: "file",
        name: baseName(path),
        path,
      }));
    return [...folders, ...files];
  };

  return toNodes(root);
}

export function ancestorDirectories(path: string): string[] {
  const parts = normalizeWorkspacePath(path).split("/").filter(Boolean);
  const directories: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    directories.push(parts.slice(0, index).join("/"));
  }
  return directories;
}
