import fs from "fs";
import path from "path";
import { StringDecoder } from "string_decoder";
import { asRecord, optionalNumber, requiredString } from "./args";
import type { AppTool } from "./types";
import { resolveInside } from "./workspace";

const MAX_WRITE = 200_000;
const DEFAULT_READ_LINES = 200;
const MAX_READ_LINES = 400;
const BATCH_READ_LINES = 120;
const MAX_BATCH_LINES = 200;
const MAX_BATCH_FILES = 8;
const MAX_BATCH_CHARS = 24_000;
const MAX_PATCH_FILE = 1_000_000;
const MAX_PATCH_TEXT = 100_000;
const MAX_LINE_CHARS = 1_000;
const MAX_PENDING_CHARS = 1_000_000;

export const fileTools: AppTool[] = [
  {
    name: "file_read",
    description:
      "Read a text file inside this agent's workspace folder. Returns numbered lines. offset is the 1-based first line (default 1). limit is how many lines to return (default 200, maximum 400). Use this instead of shell_run.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace" },
        offset: { type: "number", description: "1-based line to start at. Default 1." },
        limit: { type: "number", description: "How many lines to return. Default 200, maximum 400." },
      },
      required: ["path"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const file = resolveInside(ctx.workspaceDir, requiredString(record, "path"));
      const window = lineWindow(record, DEFAULT_READ_LINES, MAX_READ_LINES);
      return readTextWindow(file, window.offset, window.limit);
    },
  },
  {
    name: "read_many",
    description:
      "Read several workspace files in one call. Each item has path and optional offset and limit. Maximum 8 files. limit defaults to 120 lines and cannot be more than 200. Use this instead of several file_read calls.",
    parameters: {
      type: "object",
      properties: {
        files: {
          type: "array",
          description: "Up to 8 files",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              offset: { type: "number" },
              limit: { type: "number" },
            },
            required: ["path"],
          },
        },
      },
      required: ["files"],
    },
    handler: async (args, ctx) => readMany(ctx.workspaceDir, asRecord(args).files),
  },
  {
    name: "file_write",
    description:
      "Write a text file inside this agent's workspace folder. Overwrites an existing file. Use apply_patch to change part of an existing file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const content = record.content;
      if (typeof content !== "string") throw new Error("content must be a string");
      if (content.length > MAX_WRITE) throw new Error("content is too large");
      const file = resolveInside(ctx.workspaceDir, requiredString(record, "path"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
      return `wrote ${path.basename(file)} (${content.length} chars)`;
    },
  },
  {
    name: "apply_patch",
    description:
      "Replace one exact occurrence of old_string with new_string in an existing workspace file. old_string must match once. Use file_write to create a file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace" },
        old_string: { type: "string", description: "Exact text to replace. Include enough context to match once." },
        new_string: { type: "string", description: "Replacement text. May be empty to delete the match." },
      },
      required: ["path", "old_string", "new_string"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const file = resolveInside(ctx.workspaceDir, requiredString(record, "path"));
      return applyPatch(file, rawString(record, "old_string"), rawString(record, "new_string", true));
    },
  },
];

function lineWindow(record: Record<string, unknown>, fallback: number, max: number): { offset: number; limit: number } {
  const offset = Math.floor(optionalNumber(record, "offset", 1));
  const limit = Math.floor(optionalNumber(record, "limit", fallback));
  if (offset < 1) throw new Error("offset must be at least 1");
  if (limit < 1) throw new Error("limit must be at least 1");
  return { offset, limit: Math.min(limit, max) };
}

function readMany(root: string | null, files: unknown): string {
  if (!Array.isArray(files) || files.length === 0) throw new Error("files must be a non-empty array");
  if (files.length > MAX_BATCH_FILES) throw new Error(`read_many accepts at most ${MAX_BATCH_FILES} files`);
  const parts = files.map((item) => {
    const record = asRecord(item);
    const requested = requiredString(record, "path");
    try {
      const window = lineWindow(record, BATCH_READ_LINES, MAX_BATCH_LINES);
      const body = readTextWindow(resolveInside(root, requested), window.offset, window.limit);
      return `## ${requested}\n${body}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `## ${requested}\n${message}`;
    }
  });
  const text = parts.join("\n\n");
  return text.length > MAX_BATCH_CHARS ? `${text.slice(0, MAX_BATCH_CHARS)}\n…truncated` : text;
}

function rawString(record: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  if (!allowEmpty && value.length === 0) throw new Error(`Missing ${key}`);
  if (value.length > MAX_PATCH_TEXT) throw new Error(`${key} is too long`);
  return value;
}

function applyPatch(file: string, oldString: string, newString: string): string {
  if (oldString === newString) throw new Error("old_string and new_string are the same");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (isNotFound(error)) throw new Error("Path was not found. Use file_write to create a file.");
    throw error;
  }
  if (!stat.isFile()) throw new Error("Path is not a file");
  if (stat.size > MAX_PATCH_FILE) throw new Error("File is too large to patch");
  const original = fs.readFileSync(file);
  if (original.includes(0)) throw new Error("File looks binary");
  const content = original.toString("utf8");
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n");
  const oldNorm = oldString.replace(/\r\n/g, "\n");
  const newNorm = newString.replace(/\r\n/g, "\n");
  const found = countOccurrences(normalized, oldNorm);
  if (found === 0) throw new Error("old_string was not found");
  if (found > 1) throw new Error(`old_string matched ${found} times. Include more surrounding lines.`);
  const updated = replaceOnce(normalized, oldNorm, newNorm);
  const written = newline === "\r\n" ? updated.replace(/\n/g, "\r\n") : updated;
  fs.writeFileSync(file, written, "utf8");
  return `patched ${path.basename(file)}`;
}

function countOccurrences(content: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= content.length) {
    const at = content.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

function replaceOnce(content: string, oldString: string, newString: string): string {
  const at = content.indexOf(oldString);
  return content.slice(0, at) + newString + content.slice(at + oldString.length);
}

function readTextWindow(file: string, offset: number, limit: number): string {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    if (isNotFound(error)) throw new Error("Path was not found");
    throw error;
  }
  if (!stat.isFile()) throw new Error("Path is not a file");
  if (stat.size === 0) return "(empty file)";

  const fd = fs.openSync(file, "r");
  const decoder = new StringDecoder("utf8");
  const buf = Buffer.alloc(64 * 1024);
  const last = offset + limit - 1;
  const lines: string[] = [];
  let pending = "";
  let lineNo = 0;
  let hasMore = false;

  const push = (line: string) => {
    lineNo += 1;
    if (lineNo > last) {
      hasMore = true;
      return;
    }
    if (lineNo >= offset) lines.push(line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line);
  };

  try {
    while (!hasMore) {
      const bytes = fs.readSync(fd, buf, 0, buf.length, null);
      if (bytes === 0) break;
      if (buf.subarray(0, bytes).includes(0)) throw new Error("File looks binary");
      pending += decoder.write(buf.subarray(0, bytes));
      if (pending.length > MAX_PENDING_CHARS && !pending.includes("\n")) throw new Error("A line is too long to read");
      let newlineAt = findNewline(pending);
      while (newlineAt !== -1 && !hasMore) {
        const breakLen = pending.charCodeAt(newlineAt) === 13 && pending.charCodeAt(newlineAt + 1) === 10 ? 2 : 1;
        push(pending.slice(0, newlineAt));
        pending = pending.slice(newlineAt + breakLen);
        newlineAt = findNewline(pending);
      }
    }
    if (!hasMore) {
      pending += decoder.end();
      if (pending.length > 0) push(pending);
    }
  } finally {
    fs.closeSync(fd);
  }

  if (lines.length === 0) return `Offset ${offset} is past the end of the file (${lineNo} lines).`;
  const end = offset + lines.length - 1;
  const body = lines.map((line, index) => `${offset + index}|${line}`).join("\n");
  const header = hasMore
    ? `Showing lines ${offset}-${end}. More lines follow. Call file_read with offset ${end + 1}.`
    : `Showing lines ${offset}-${end} of ${lineNo}.`;
  return `${header}\n${body}`;
}

function findNewline(value: string): number {
  const index = value.indexOf("\n");
  if (index === -1) return -1;
  return index > 0 && value.charCodeAt(index - 1) === 13 ? index - 1 : index;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}
