import fs from "fs";
import path from "path";
import type { WorkspaceRuleFile } from "../shared/types";

const RULE_FILES = ["AGENTS.md", "CLAUDE.md", ".fid/instructions.md", ".github/copilot-instructions.md"];
const MAX_FILE_CHARS = 8_000;
const MAX_TOTAL_CHARS = 16_000;
const MAX_READ_BYTES = 64_000;

const TEMPLATE = `# Workspace instructions

Agents load this file at the start of every turn. Keep it short and specific.

## Commands
- Build:
- Test:
- Lint:

## Conventions
-
`;

export type WorkspaceRules = {
  text: string;
  files: WorkspaceRuleFile[];
};

const cache = new Map<string, { key: string; result: WorkspaceRules }>();

export function workspaceRules(root: string): WorkspaceRules {
  const resolved = path.resolve(root);
  const entries = RULE_FILES.map((relative) => ({ relative, absolute: path.join(resolved, relative) })).filter(
    (entry) => {
      try {
        return fs.statSync(entry.absolute).isFile();
      } catch {
        return false;
      }
    },
  );
  const key =
    entries
      .map((entry) => {
        try {
          const stat = fs.statSync(entry.absolute);
          return `${entry.relative}:${stat.mtimeMs}:${stat.size}`;
        } catch {
          return `${entry.relative}:missing`;
        }
      })
      .join("|") || "none";

  const hit = cache.get(resolved);
  if (hit?.key === key) return hit.result;

  const parts: string[] = [];
  const files: WorkspaceRuleFile[] = [];
  let total = 0;
  for (const entry of entries) {
    if (total >= MAX_TOTAL_CHARS) break;
    const head = readHead(entry.absolute, Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - total));
    if (!head) continue;
    files.push({ path: entry.relative, chars: head.text.length, truncated: head.truncated });
    parts.push(`### ${entry.relative}\n${head.text}${head.truncated ? "\n…(truncated)" : ""}`);
    total += head.text.length;
  }

  const result: WorkspaceRules = parts.length
    ? {
        text: `Project rules (from workspace files, follow these):\n\n${parts.join("\n\n")}`,
        files,
      }
    : { text: "", files: [] };
  cache.set(resolved, { key, result });
  return result;
}

export function createAgentsFile(root: string): WorkspaceRules {
  const resolved = path.resolve(root);
  const file = path.join(resolved, "AGENTS.md");
  let write = true;
  try {
    write = fs.statSync(file).size === 0;
  } catch {
    write = true;
  }
  if (write) fs.writeFileSync(file, TEMPLATE, "utf8");
  cache.delete(resolved);
  return workspaceRules(resolved);
}

export function ruleFilePath(root: string, relative: string): string | null {
  const normalized = relative.replace(/\\/g, "/");
  if (!RULE_FILES.includes(normalized)) return null;
  const absolute = path.resolve(root, normalized);
  const inside = path.relative(path.resolve(root), absolute);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return absolute;
}

function readHead(file: string, maxChars: number): { text: string; truncated: boolean } | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return null;
    const bytesToRead = Math.min(stat.size, MAX_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const fd = fs.openSync(file, "r");
    let bytes = 0;
    try {
      bytes = fs.readSync(fd, buffer, 0, bytesToRead, 0);
    } finally {
      fs.closeSync(fd);
    }
    const data = buffer.subarray(0, bytes);
    if (data.includes(0)) return null;
    const text = data.toString("utf8");
    if (text.length <= maxChars) {
      return { text, truncated: stat.size > bytesToRead };
    }
    return { text: text.slice(0, maxChars), truncated: true };
  } catch {
    return null;
  }
}
