import type { FileChangeSummary } from "./types";

export type ChangeTreeFolder = {
  kind: "folder";
  name: string;
  path: string;
  children: ChangeTreeNode[];
};

export type ChangeTreeFile = {
  kind: "file";
  name: string;
  path: string;
  file: FileChangeSummary;
};

export type ChangeTreeNode = ChangeTreeFolder | ChangeTreeFile;

type FolderBuilder = {
  name: string;
  path: string;
  folders: Map<string, FolderBuilder>;
  files: FileChangeSummary[];
};

function baseName(path: string): string {
  return path.split("/").pop() || path;
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function buildChangeTree(files: FileChangeSummary[]): ChangeTreeNode[] {
  const root: FolderBuilder = { name: "", path: "", folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part;
      let child = folder.folders.get(part);
      if (!child) {
        child = { name: part, path, folders: new Map(), files: [] };
        folder.folders.set(part, child);
      }
      folder = child;
    }
    folder.files.push({ ...file, path: file.path.replace(/\\/g, "/") });
  }

  const toNodes = (folder: FolderBuilder): ChangeTreeNode[] => {
    const folders = [...folder.folders.values()]
      .sort((a, b) => compareNames(a.name, b.name))
      .map((child): ChangeTreeFolder => ({
        kind: "folder",
        name: child.name,
        path: child.path,
        children: toNodes(child),
      }));
    const files = [...folder.files]
      .sort((a, b) => compareNames(baseName(a.path), baseName(b.path)))
      .map((file): ChangeTreeFile => ({
        kind: "file",
        name: baseName(file.path),
        path: file.path,
        file,
      }));
    return [...folders, ...files];
  };

  return toNodes(root);
}

export function filterChangeTree(nodes: ChangeTreeNode[], query: string): ChangeTreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;

  const visit = (node: ChangeTreeNode): ChangeTreeNode | null => {
    if (node.kind === "file") {
      return node.path.toLowerCase().includes(needle) ? node : null;
    }
    if (node.path.toLowerCase().includes(needle)) return node;
    const children = node.children
      .map(visit)
      .filter((child): child is ChangeTreeNode => child !== null);
    return children.length > 0 ? { ...node, children } : null;
  };

  return nodes.map(visit).filter((node): node is ChangeTreeNode => node !== null);
}
