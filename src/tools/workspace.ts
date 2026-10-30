import fs from "fs";
import path from "path";

export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "release",
  ".git",
  "target",
  "build",
  ".gradle",
  ".kotlin",
  ".mvn",
  "out",
  "bin",
  ".idea",
  ".settings",
  "nbproject",
]);

export function workspaceRoot(root: string | null): string {
  if (!root) throw new Error("Pick a workspace folder for this agent first");
  return path.resolve(root);
}

export function isInsideWorkspace(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveInside(root: string | null, requested: string | null): string {
  const base = workspaceRoot(root);
  const target = requested ? path.resolve(base, requested) : base;
  if (!isInsideWorkspace(base, target)) throw new Error("Path is outside the workspace folder");
  if (fs.existsSync(target)) {
    try {
      const real = fs.realpathSync(target);
      if (!isInsideWorkspace(base, real)) throw new Error("Path is outside the workspace folder");
    } catch (error) {
      if (error instanceof Error && error.message === "Path is outside the workspace folder") throw error;
    }
  }
  return target;
}

export function relativeInside(root: string, target: string): string {
  const relative = path.relative(path.resolve(root), target);
  if (!relative) return "";
  return relative.split(path.sep).join("/");
}
