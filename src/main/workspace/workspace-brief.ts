import fs from "fs";
import path from "path";
import { runArgv } from "../../tools/process";
import { SKIP_DIR_NAMES } from "../../tools/workspace";

const MAX_BRIEF = 6_000;
const GIT_TIMEOUT_MS = 5_000;

const cache = new Map<string, { key: string; text: string }>();

export async function workspaceBrief(root: string): Promise<string> {
  const resolved = path.resolve(root);
  const head = (await tryGit(resolved, ["rev-parse", "HEAD"])) ?? "";
  const key = head || "none";
  const hit = cache.get(resolved);
  if (hit?.key === key) return hit.text;
  let text = "";
  try {
    text = cap(await renderBrief(resolved));
  } catch {
    return "";
  }
  cache.set(resolved, { key, text });
  return text;
}

async function renderBrief(root: string): Promise<string> {
  const sections = ["Workspace brief:", tree(root), manifest(root), await gitSection(root)];
  sections.push("Call git_status for the live status. This brief refreshes when HEAD changes.");
  return sections.filter(Boolean).join("\n\n");
}

function tree(root: string): string {
  const lines = ["."];
  const visible = visibleEntries(root);
  for (const entry of visible.slice(0, 40)) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      lines.push(`  ${entry.name}/`);
      lines.push(...children(path.join(root, entry.name)));
      continue;
    }
    lines.push(`  ${entry.name}`);
  }
  if (visible.length > 40) lines.push("  …");
  return lines.join("\n");
}

function children(dir: string): string[] {
  const visible = visibleEntries(dir);
  const lines = visible.slice(0, 12).map((entry) => `    ${entry.name}${entry.isDirectory() ? "/" : ""}`);
  if (visible.length > 12) lines.push("    …");
  return lines;
}

function visibleEntries(dir: string): fs.Dirent[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !(entry.isDirectory() && SKIP_DIR_NAMES.has(entry.name)))
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch {
    return [];
  }
}

function rank(entry: fs.Dirent): number {
  if (entry.isDirectory()) return 0;
  if (entry.isFile()) return 1;
  return 2;
}

function manifest(root: string): string {
  const parts: string[] = [];
  const scripts = packageScripts(root);
  if (scripts) parts.push(scripts);
  const maven = mavenId(root);
  if (maven) parts.push(maven);
  const gradle = gradleStart(root);
  if (gradle) parts.push(gradle);
  const heading = readmeHeading(root);
  if (heading) parts.push(`README: ${heading}`);
  return parts.join("\n");
}

function packageScripts(root: string): string | null {
  const file = path.join(root, "package.json");
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== "object") return "package.json";
    const names = Object.keys(parsed.scripts).slice(0, 20);
    return names.length ? `package.json scripts: ${names.join(", ")}` : "package.json";
  } catch {
    return "package.json could not be parsed";
  }
}

function mavenId(root: string): string | null {
  const file = path.join(root, "pom.xml");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8").slice(0, 12_000);
  const artifact = text.match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/);
  return artifact?.[1] ? `Maven artifact: ${artifact[1]}` : "pom.xml";
}

function gradleStart(root: string): string | null {
  const name = ["build.gradle", "build.gradle.kts"].find((item) => fs.existsSync(path.join(root, item)));
  if (!name) return null;
  const text = fs.readFileSync(path.join(root, name), "utf8").slice(0, 500).trim();
  return text ? `${name}:\n${text}` : name;
}

function readmeHeading(root: string): string | null {
  const name = ["README.md", "README.txt", "readme.md"].find((item) => fs.existsSync(path.join(root, item)));
  if (!name) return null;
  const text = fs.readFileSync(path.join(root, name), "utf8").slice(0, 4_000);
  const heading = text.split(/\r?\n/).find((line) => /^#{1,3}\s+\S/.test(line));
  return heading ? heading.replace(/^#{1,3}\s+/, "").trim() : null;
}

async function gitSection(root: string): Promise<string> {
  const [branch, status, log] = await Promise.all([
    tryGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    tryGit(root, ["status", "--porcelain", "--branch"]),
    tryGit(root, ["log", "-5", "--oneline"]),
  ]);
  if (!branch && !status && !log) return "git: not available";
  const statusLines = (status ?? "").split("\n").filter(Boolean);
  const shown = statusLines.slice(0, 30);
  if (statusLines.length > 30) shown.push(`… ${statusLines.length - 30} more`);
  return [`git: ${branch ?? "unknown"}`, shown.length ? shown.join("\n") : "status: clean", log ? `recent commits:\n${log}` : ""]
    .filter(Boolean)
    .join("\n");
}

async function tryGit(root: string, args: string[]): Promise<string | null> {
  try {
    const result = await runArgv("git", args, root, GIT_TIMEOUT_MS);
    if (result.code !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

function cap(text: string): string {
  return text.length <= MAX_BRIEF ? text : `${text.slice(0, MAX_BRIEF)}\n…brief truncated`;
}
