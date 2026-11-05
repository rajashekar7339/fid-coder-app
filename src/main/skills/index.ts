import fs from "fs";
import path from "path";
import { composeSkillPrompt, isSkillId, parseSkillMarkdown, selectSkills } from "../../shared/skills";
import type { SkillCatalog, SkillContent, SkillInfo, SkillSource } from "../../shared/types";
import { copilotSkillsDirs, skillsDir, userSkillsDir } from "../paths";

const MAX_SKILL_BYTES = 64_000;

const SOURCE_NAMES: Record<SkillSource, string> = {
  workspace: "workspace",
  app: "your skills",
  copilot: "Copilot",
  builtin: "built-in",
};

export type SkillRoot = {
  root: string;
  source: SkillSource;
};

export type LoadedSkill = SkillInfo & {
  body: string;
  path: string;
};

type RootScan = {
  skills: LoadedSkill[];
  warnings: string[];
};

const cache = new Map<string, RootScan>();

export function skillRoots(workspaceDir: string | null): SkillRoot[] {
  const roots: SkillRoot[] = [];
  if (workspaceDir?.trim()) {
    const base = path.resolve(workspaceDir);
    for (const relative of [".github/skills", ".agents/skills", ".claude/skills"]) {
      roots.push({ root: path.join(base, relative), source: "workspace" });
    }
  }
  roots.push({ root: userSkillsDir(), source: "app" });
  for (const root of copilotSkillsDirs()) roots.push({ root, source: "copilot" });
  roots.push({ root: skillsDir(), source: "builtin" });
  return roots;
}

export function loadSkillCatalog(roots: readonly SkillRoot[]): LoadedSkill[] {
  return scanSkillRoots(roots).skills;
}

export function listSkillInfo(roots: readonly SkillRoot[]): SkillCatalog {
  const scan = scanSkillRoots(roots);
  return {
    skills: scan.skills.map(({ id, name, description, source, chars }) => ({
      id,
      name,
      description,
      source,
      chars,
    })),
    warnings: scan.warnings,
  };
}

export function readSkill(roots: readonly SkillRoot[], id: string, source?: SkillSource): SkillContent | null {
  const skill = loadSkillCatalog(roots).find(
    (item) => item.id === id && (!source || item.source === source),
  );
  return skill
    ? {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        source: skill.source,
        chars: skill.chars,
        path: skill.path,
        body: skill.body,
      }
    : null;
}

export function skillsForAgent(
  roots: readonly SkillRoot[],
  ids: readonly string[],
): { prompt: string; names: string[] } {
  return composeSkillPrompt(selectSkills(loadSkillCatalog(roots), ids));
}

function scanSkillRoots(roots: readonly SkillRoot[]): RootScan {
  const skills = new Map<string, LoadedSkill>();
  const warnings: string[] = [];
  for (const root of roots) {
    const scan = scanRoot(root);
    warnings.push(...scan.warnings);
    for (const skill of scan.skills) {
      const existing = skills.get(skill.id);
      if (existing) {
        warnings.push(
          `${skill.id} in ${SOURCE_NAMES[skill.source]} is hidden by the ${SOURCE_NAMES[existing.source]} copy`,
        );
        continue;
      }
      skills.set(skill.id, skill);
    }
  }
  return {
    skills: [...skills.values()].sort((left, right) => left.id.localeCompare(right.id)),
    warnings,
  };
}

function scanRoot({ root, source }: SkillRoot): RootScan {
  const resolved = path.resolve(root);
  let dirents: fs.Dirent[];
  try {
    dirents = fs.readdirSync(resolved, { withFileTypes: true });
  } catch {
    return { skills: [], warnings: [] };
  }
  const candidates = dirents
    .filter((entry) => entry.isDirectory() && isSkillId(entry.name))
    .map((entry) => entry.name)
    .sort();
  const entries: { id: string; file: string; mtimeMs: number; size: number }[] = [];
  const warnings: string[] = [];
  for (const id of candidates) {
    const file = path.join(resolved, id, "SKILL.md");
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) {
        warnings.push(`${id} in ${SOURCE_NAMES[source]} has no SKILL.md`);
        continue;
      }
      if (stat.size === 0) {
        warnings.push(`${id} in ${SOURCE_NAMES[source]} has an empty SKILL.md`);
        continue;
      }
      if (stat.size > MAX_SKILL_BYTES) {
        warnings.push(`${id} in ${SOURCE_NAMES[source]} is larger than ${MAX_SKILL_BYTES} bytes`);
        continue;
      }
      entries.push({ id, file, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      warnings.push(`${id} in ${SOURCE_NAMES[source]} has no SKILL.md`);
    }
  }
  const key = `${source}|${resolved}|${candidates.join(",")}|${entries
    .map((entry) => `${entry.id}:${entry.mtimeMs}:${entry.size}`)
    .join("|")}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const skills: LoadedSkill[] = [];
  for (const entry of entries) {
    let text = "";
    try {
      text = fs.readFileSync(entry.file, "utf8");
    } catch {
      warnings.push(`${entry.id} in ${SOURCE_NAMES[source]} could not be read`);
      continue;
    }
    if (text.includes("\0")) {
      warnings.push(`${entry.id} in ${SOURCE_NAMES[source]} is not a text file`);
      continue;
    }
    const parsed = parseSkillMarkdown(text);
    if (!parsed) {
      warnings.push(`${entry.id} in ${SOURCE_NAMES[source]} needs name and description frontmatter`);
      continue;
    }
    skills.push({
      id: entry.id,
      name: parsed.name,
      description: parsed.description,
      source,
      chars: parsed.body.length,
      body: parsed.body,
      path: entry.file,
    });
  }
  const result = { skills, warnings };
  cache.set(key, result);
  return result;
}
