import type { SkillInfo } from "./types";

export const SKILL_ID = /^[a-z0-9-]{1,64}$/;
export const MAX_SKILLS = 8;
export const MAX_SKILL_CHARS = 8_000;
export const MAX_SKILLS_CHARS = 16_000;

const SKILL_LEAD = "Active skills for this agent. Follow them on every turn.";

export type SkillText = {
  name: string;
  description: string;
  body: string;
};

export function isSkillId(value: string): boolean {
  return SKILL_ID.test(value);
}

export function normalizeSkillIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!isSkillId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_SKILLS) break;
  }
  return ids;
}

export function parseSkillMarkdown(text: string): SkillText | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const name = readScalar(match[1], "name")?.slice(0, 80);
  const description = readScalar(match[1], "description")?.slice(0, 400);
  if (!name || !description) return null;
  return { name, description, body: text.slice(match[0].length).trim() };
}

export function selectSkills<T extends { id: string }>(catalog: T[], ids: readonly string[]): T[] {
  const byId = new Map(catalog.map((skill) => [skill.id, skill]));
  const chosen: T[] = [];
  for (const id of normalizeSkillIds(ids)) {
    const skill = byId.get(id);
    if (skill) chosen.push(skill);
  }
  return chosen;
}

export function composeSkillPrompt(skills: readonly { name: string; body: string }[]): string {
  if (skills.length === 0) return "";
  const parts = [SKILL_LEAD];
  let total = 0;
  for (const skill of skills) {
    if (total >= MAX_SKILLS_CHARS) break;
    const room = Math.min(MAX_SKILL_CHARS, MAX_SKILLS_CHARS - total);
    const raw = skill.body.trim();
    const truncated = raw.length > room;
    const body = truncated ? raw.slice(0, room) : raw;
    parts.push(`### ${skill.name}\n${body}${truncated ? "\n…(truncated)" : ""}`);
    total += body.length;
  }
  return parts.join("\n\n");
}

export function skillCatalogEntry(id: string, text: SkillText): SkillInfo {
  return { id, name: text.name, description: text.description };
}

function readScalar(front: string, key: string): string | null {
  const lines = front.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!match) continue;
    const rest = match[1].trim();
    if (rest === ">" || rest === "|") {
      const folded: string[] = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        if (!/^\s+\S/.test(lines[next])) break;
        folded.push(lines[next].trim());
      }
      const joined = (rest === ">" ? folded.join(" ") : folded.join("\n")).trim();
      return joined || null;
    }
    if (!rest) return null;
    return rest.replace(/^["']|["']$/g, "").trim() || null;
  }
  return null;
}
