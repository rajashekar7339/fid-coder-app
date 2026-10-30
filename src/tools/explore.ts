import { spawn } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { asRecord, optionalBoolean, optionalNumber, optionalString, requiredString } from "./args";
import type { AppTool } from "./types";
import { SKIP_DIR_NAMES, isInsideWorkspace, relativeInside, resolveInside, workspaceRoot } from "./workspace";

const MAX_LIST = 200;
const MAX_GLOB = 200;
const MAX_VISITS = 20_000;
const MAX_SEARCH_CHARS = 16_000;
const SEARCH_TIMEOUT_MS = 20_000;
const SKIP_NOTE = `Skips ${[...SKIP_DIR_NAMES].join(", ")} unless that folder was requested.`;

export const exploreTools: AppTool[] = [
  {
    name: "list_dir",
    description:
      `List one folder inside the workspace. Returns each name and whether it is a file or directory. ${SKIP_NOTE} Use this instead of shell_run.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder relative to the workspace. Omit for the workspace root." },
      },
    },
    handler: async (args, ctx) => listDirectory(workspaceRoot(ctx.workspaceDir), optionalString(asRecord(args), "path")),
  },
  {
    name: "glob_files",
    description:
      `Find file paths inside the workspace. pattern uses * and **, and a pattern without / searches the whole tree. ${SKIP_NOTE} Returns paths only. Use this instead of shell_run.`,
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob such as **/*runner*.ts or *.md" },
        path: { type: "string", description: "Optional folder relative to the workspace" },
      },
      required: ["pattern"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      return globFiles(workspaceRoot(ctx.workspaceDir), requiredString(record, "pattern"), optionalString(record, "path"));
    },
  },
  {
    name: "search_text",
    description:
      `Search file contents inside the workspace. Fixed string by default; set regex true for a regular expression. Returns path:line:text. ${SKIP_NOTE} Use this instead of shell_run.`,
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text to find" },
        path: { type: "string", description: "Optional file or folder relative to the workspace" },
        glob: { type: "string", description: "Optional glob such as *.ts" },
        regex: { type: "boolean", description: "Treat pattern as a regular expression" },
        context: { type: "number", description: "Context lines around each hit. Default 2, maximum 3." },
      },
      required: ["pattern"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const pattern = requiredString(record, "pattern");
      if (pattern.length > 500 || /[\r\n]/.test(pattern)) throw new Error("pattern is too long");
      const context = Math.max(0, Math.min(3, Math.floor(optionalNumber(record, "context", 2))));
      return searchText(workspaceRoot(ctx.workspaceDir), {
        pattern,
        path: optionalString(record, "path"),
        glob: cleanGlob(optionalString(record, "glob")),
        regex: optionalBoolean(record, "regex"),
        context,
      });
    },
  },
];

async function listDirectory(root: string, requested: string | null): Promise<string> {
  const dir = resolveInside(root, requested);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(dir);
  } catch (error) {
    if (isNotFound(error)) throw new Error("Path was not found");
    throw error;
  }
  if (!stat.isDirectory()) throw new Error("Path is not a directory");
  const listing = relativeInside(root, dir);
  const insideSkip = listing.split("/").some((part) => SKIP_DIR_NAMES.has(part));
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const rows: { kind: "dir" | "file" | "link"; name: string }[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      rows.push({ kind: "link", name: entry.name });
      continue;
    }
    if (entry.isDirectory()) {
      if (!insideSkip && SKIP_DIR_NAMES.has(entry.name)) continue;
      rows.push({ kind: "dir", name: entry.name });
      continue;
    }
    if (entry.isFile()) rows.push({ kind: "file", name: entry.name });
  }
  rows.sort((a, b) => {
    const rank = a.kind === "dir" ? 0 : a.kind === "file" ? 1 : 2;
    const other = b.kind === "dir" ? 0 : b.kind === "file" ? 1 : 2;
    return rank - other || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  const header = listing || ".";
  if (rows.length === 0) return `${header}\n(empty)`;
  const shown = rows.slice(0, MAX_LIST);
  const lines = await Promise.all(
    shown.map(async (row) => {
      if (row.kind !== "file") return `[${row.kind}] ${row.name}`;
      try {
        const size = (await fs.promises.stat(path.join(dir, row.name))).size;
        return `[file] ${row.name} (${formatSize(size)})`;
      } catch {
        return `[file] ${row.name}`;
      }
    }),
  );
  if (rows.length > MAX_LIST) lines.push(`… ${rows.length - MAX_LIST} more entries`);
  return [header, ...lines].join("\n");
}

async function globFiles(root: string, pattern: string, requested: string | null): Promise<string> {
  if (pattern.length > 500 || /[\r\n]/.test(pattern)) throw new Error("pattern is too long");
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.isAbsolute(pattern) || /^[a-zA-Z]:/.test(normalized)) throw new Error("pattern must be a relative glob");
  const effective = normalized.includes("/") || normalized.includes("**") ? normalized : `**/${normalized}`;
  const matcher = globToRegExp(effective);
  const base = resolveInside(root, requested);
  let baseStat: fs.Stats;
  try {
    baseStat = await fs.promises.stat(base);
  } catch (error) {
    if (isNotFound(error)) throw new Error("Path was not found");
    throw error;
  }
  if (!baseStat.isDirectory()) throw new Error("Path is not a directory");
  const startRel = relativeInside(root, base);
  const matches: string[] = [];
  let visits = 0;
  let stopped = false;

  const walk = async (dir: string): Promise<void> => {
    if (stopped) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (stopped) return;
      visits += 1;
      if (visits > MAX_VISITS) {
        stopped = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        let real = full;
        try {
          real = await fs.promises.realpath(full);
        } catch {
          continue;
        }
        if (!isInsideWorkspace(root, real)) continue;
        const rel = relativeInside(root, full);
        if (SKIP_DIR_NAMES.has(entry.name) && !explicitSkip(startRel, rel)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relativeInside(root, full);
      const underStart = startRel && rel.startsWith(`${startRel}/`) ? rel.slice(startRel.length + 1) : rel;
      if (!matcher.test(rel) && !matcher.test(underStart)) continue;
      matches.push(rel);
      if (matches.length >= MAX_GLOB) {
        stopped = true;
        return;
      }
    }
  };

  await walk(base);
  matches.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  if (matches.length === 0) return stopped ? "No files matched. The search stopped early. Narrow the pattern or path." : "No files matched.";
  const lines = [...matches];
  if (stopped) lines.push(`… stopped after ${matches.length} matches. Narrow the pattern or path.`);
  return lines.join("\n");
}

function explicitSkip(startRel: string, dirRel: string): boolean {
  return startRel === dirRel || startRel.startsWith(`${dirRel}/`);
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        source += ".*";
        i += 1;
        if (pattern[i + 1] === "/") i += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${source}$`, process.platform === "win32" ? "i" : "");
}

type SearchInput = {
  pattern: string;
  path: string | null;
  glob: string | null;
  regex: boolean;
  context: number;
};

async function searchText(root: string, input: SearchInput): Promise<string> {
  const target = resolveInside(root, input.path);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(target);
  } catch (error) {
    if (isNotFound(error)) throw new Error("Path was not found");
    throw error;
  }
  if (!stat.isFile() && !stat.isDirectory()) throw new Error("Path is not a file or directory");
  const relative = relativeInside(root, target);
  const args = [
    "--line-number",
    "--no-heading",
    "--color",
    "never",
    "--smart-case",
    "--hidden",
    "--path-separator",
    "/",
    "--max-columns",
    "400",
    "--max-columns-preview",
    "--max-count",
    "20",
    "--max-filesize",
    "512K",
    "-C",
    String(input.context),
  ];
  for (const name of SKIP_DIR_NAMES) {
    if (relative === name || relative.startsWith(`${name}/`)) continue;
    args.push("--glob", `!${name}/**`);
  }
  if (input.glob) args.push("--glob", input.glob);
  if (!input.regex) args.push("--fixed-strings");
  // A path is required. With a piped stdin, ripgrep waits on stdin instead of searching the folder.
  args.push("--", input.pattern, relative || ".");

  const result = await runRg(rgExecutable(), args, root);
  if (result.clipped) {
    const body = result.stdout.trimEnd();
    return body ? `${body}\n…truncated. Narrow the path, glob, or pattern.` : "…truncated. Narrow the path, glob, or pattern.";
  }
  if (result.code === 1 || (result.code === 0 && !result.stdout.trim())) return "No matches.";
  if (result.code !== 0) {
    const detail = result.stderr.trim().slice(0, 500);
    throw new Error(detail ? `Search failed: ${detail}` : "Search failed");
  }
  return result.stdout.trimEnd();
}

function cleanGlob(value: string | null): string | null {
  if (!value) return null;
  if (value.length > 200 || /[\r\n]/.test(value) || value.startsWith("-")) throw new Error("glob is invalid");
  return value;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function rgExecutable(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const packed = path.join(resourcesPath, "ripgrep", process.platform === "win32" ? "rg.exe" : "rg");
    if (fs.existsSync(packed)) return packed;
  }
  const binaryName = process.platform === "win32" ? "rg.exe" : "rg";
  const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;
  try {
    const resolved = moduleRequire().resolve(`${platformPkg}/bin/${binaryName}`);
    const unpacked = resolved.includes(`${path.sep}app.asar${path.sep}`)
      ? resolved.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
      : resolved;
    if (fs.existsSync(unpacked)) return unpacked;
  } catch {
    // The optional platform package is absent.
  }
  throw new Error("Search is unavailable because ripgrep was not found. Reinstall Fid Coder.");
}

function moduleRequire(): NodeRequire {
  try {
    if (typeof __filename === "string") return createRequire(__filename);
  } catch {
    // ESM loads have no __filename binding.
  }
  return createRequire(path.join(process.cwd(), "package.json"));
}

function runRg(
  executable: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; stdout: string; stderr: string; clipped: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let clipped = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Search timed out after 20s"));
    }, SEARCH_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      if (clipped) return;
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_SEARCH_CHARS * 3) {
        clipped = true;
        stdout = stdout.slice(0, MAX_SEARCH_CHARS);
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.replace(/\r\n/g, "\n"), stderr, clipped });
    });
  });
}
