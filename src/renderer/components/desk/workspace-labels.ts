import type { Citation } from "../../../shared/citations";

export type CitationView = {
  path: string;
  line: number;
  endLine: number | null;
};

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function directoryName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const at = normalized.lastIndexOf("/");
  return at > 0 ? normalized.slice(0, at) : "workspace";
}

export function rangeLabel(line: number, endLine: number | null): string {
  return endLine === null || endLine === line ? String(line) : `${line}–${endLine}`;
}

export function referenceLabel(reference: Citation): string {
  return `${reference.path}:${reference.line}${
    reference.endLine === null || reference.endLine === reference.line
      ? ""
      : `-${reference.endLine}`
  }`;
}
