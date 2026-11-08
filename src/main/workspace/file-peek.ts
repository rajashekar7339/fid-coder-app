import fs from "fs";
import { relativeInside, resolveInside } from "../../tools/workspace";
import type { WorkspaceFilePeek } from "../../shared/types";

const MAX_BYTES = 512_000;
const WINDOW_LINES = 160;
const CONTEXT_LINES = 60;

export function readWorkspaceFile(
  workspaceDir: string,
  requested: string,
  line: number | null = null,
): WorkspaceFilePeek {
  if (!requested.trim()) throw new Error("Choose a file to read");
  const file = resolveInside(workspaceDir, requested);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error("That file was not found");
  }
  if (!stat.isFile()) throw new Error("That path is not a file");
  if (stat.size > MAX_BYTES) throw new Error("That file is too large to preview");

  const data = fs.readFileSync(file);
  if (data.includes(0)) throw new Error("That file looks binary");
  const lines = data.toString("utf8").split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const totalLines = lines.length;
  if (totalLines === 0) {
    return {
      path: relativeInside(workspaceDir, file),
      text: "",
      startLine: 1,
      endLine: 0,
      totalLines: 0,
      line: null,
      truncated: false,
    };
  }

  const target = line === null || !Number.isFinite(line) ? null : Math.min(totalLines, Math.max(1, Math.floor(line)));
  const startLine = target === null ? 1 : Math.max(1, target - CONTEXT_LINES);
  const endLine = Math.min(totalLines, startLine + WINDOW_LINES - 1);
  return {
    path: relativeInside(workspaceDir, file),
    text: lines.slice(startLine - 1, endLine).join("\n"),
    startLine,
    endLine,
    totalLines,
    line: target,
    truncated: startLine > 1 || endLine < totalLines,
  };
}
