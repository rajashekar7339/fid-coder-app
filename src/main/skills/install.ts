import fs from "fs";
import path from "path";
import { isSkillId, parseSkillMarkdown } from "../../shared/skills";
import type { SkillInfo } from "../../shared/types";

const MAX_SKILL_BYTES = 64_000;
const MAX_BUNDLE_BYTES = 2_000_000;
const MAX_BUNDLE_FILES = 64;

export type SkillImportPlan = {
  id: string;
  name: string;
  description: string;
  version: string | null;
  chars: number;
  sourceDir: string;
};

export function planSkillImport(source: string): SkillImportPlan | { error: string } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(source);
  } catch {
    return { error: "The selected skill folder could not be read." };
  }
  if (!stat.isDirectory()) return { error: "Choose a folder that contains SKILL.md." };
  const skillFile = path.join(source, "SKILL.md");
  if (!fs.existsSync(skillFile)) {
    return { error: "That folder has no SKILL.md." };
  }
  let text: string;
  try {
    text = fs.readFileSync(skillFile, "utf8");
  } catch {
    return { error: "The SKILL.md file could not be read." };
  }
  if (Buffer.byteLength(text, "utf8") > MAX_SKILL_BYTES) {
    return { error: `SKILL.md is larger than ${MAX_SKILL_BYTES} bytes.` };
  }
  const parsed = parseSkillMarkdown(text);
  if (!parsed) return { error: "SKILL.md needs name and description frontmatter." };
  const id = skillIdFor(source, parsed.name);
  if (!id) {
    return { error: "Rename the folder to lowercase letters, numbers, and dashes." };
  }
  return {
    id,
    name: parsed.name,
    description: parsed.description,
    version: parsed.version,
    chars: parsed.body.length,
    sourceDir: source,
  };
}

export function installSkill(
  plan: SkillImportPlan,
  destRoot: string,
  replace: boolean,
): SkillInfo {
  const dest = path.join(destRoot, plan.id);
  if (fs.existsSync(dest) && !replace) {
    throw new Error(`A skill named ${plan.id} is already installed.`);
  }
  fs.mkdirSync(destRoot, { recursive: true });
  const staging = path.join(destRoot, `.incoming-${plan.id}-${Date.now()}`);
  const backup = `${dest}.old-${Date.now()}`;
  try {
    copyBundle(plan.sourceDir, staging);
    let movedOld = false;
    if (fs.existsSync(dest)) {
      fs.renameSync(dest, backup);
      movedOld = true;
    }
    try {
      fs.renameSync(staging, dest);
    } catch (error) {
      if (movedOld) fs.renameSync(backup, dest);
      throw error;
    }
    if (movedOld) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    version: plan.version,
    source: "app",
    chars: plan.chars,
  };
}

function skillIdFor(folder: string, name: string): string | null {
  const base = path.basename(folder).trim().toLowerCase();
  if (isSkillId(base)) return base;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return isSkillId(slug) ? slug : null;
}

function copyBundle(source: string, target: string): void {
  copyDirectory(source, target, { bytes: 0, files: 0 });
}

function copyDirectory(from: string, to: string, totals: { bytes: number; files: number }): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === ".git" || entry.name === "node_modules") continue;
    const fromPath = path.join(from, entry.name);
    const toPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(fromPath, toPath, totals);
      continue;
    }
    if (!entry.isFile()) continue;
    totals.bytes += fs.statSync(fromPath).size;
    totals.files += 1;
    if (totals.bytes > MAX_BUNDLE_BYTES) throw new Error("The skill folder is larger than 2 MB.");
    if (totals.files > MAX_BUNDLE_FILES) {
      throw new Error(`The skill folder has more than ${MAX_BUNDLE_FILES} files.`);
    }
    fs.copyFileSync(fromPath, toPath);
  }
}
