import fs from "fs";
import path from "path";
import {
  composeSkillPrompt,
  isSkillId,
  parseSkillMarkdown,
  selectSkills,
  skillCatalogEntry,
} from "../../shared/skills";
import type { SkillInfo } from "../../shared/types";

const MAX_SKILL_BYTES = 64_000;

export type LoadedSkill = SkillInfo & {
  body: string;
};

const cache = new Map<string, { key: string; skills: LoadedSkill[] }>();

export function loadSkillCatalog(root: string): LoadedSkill[] {
  const resolved = path.resolve(root);
  const entries = readEntries(resolved);
  const key = entries.map((entry) => `${entry.id}:${entry.mtimeMs}:${entry.size}`).join("|") || "none";
  const hit = cache.get(resolved);
  if (hit?.key === key) return hit.skills;

  const skills: LoadedSkill[] = [];
  for (const entry of entries) {
    let text = "";
    try {
      text = fs.readFileSync(entry.file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    const parsed = parseSkillMarkdown(text);
    if (!parsed) continue;
    skills.push({ ...skillCatalogEntry(entry.id, parsed), body: parsed.body });
  }
  cache.set(resolved, { key, skills });
  return skills;
}

export function listSkillInfo(root: string): SkillInfo[] {
  return loadSkillCatalog(root).map(({ id, name, description }) => ({ id, name, description }));
}

export function skillsForAgent(root: string, ids: readonly string[]): { prompt: string; names: string[] } {
  const chosen = selectSkills(loadSkillCatalog(root), ids);
  return {
    prompt: composeSkillPrompt(chosen),
    names: chosen.map((skill) => skill.name),
  };
}

function readEntries(root: string): { id: string; file: string; mtimeMs: number; size: number }[] {
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries: { id: string; file: string; mtimeMs: number; size: number }[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || !isSkillId(dirent.name)) continue;
    const file = path.join(root, dirent.name, "SKILL.md");
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_SKILL_BYTES) continue;
      entries.push({ id: dirent.name, file, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      continue;
    }
  }
  entries.sort((left, right) => left.id.localeCompare(right.id));
  return entries;
}
