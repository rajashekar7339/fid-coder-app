import type { SkillFile, SkillSource } from "./types";

export const SKILL_ID = /^[a-z0-9-]{1,64}$/;
export const MAX_SKILL_CHARS = 8_000;
export const MAX_SKILL_DESCRIPTION = 1_024;

export const SKILL_SOURCE_LABELS: Record<SkillSource, string> = {
  workspace: "Workspace",
  app: "Your skills",
  copilot: "Copilot",
  builtin: "Built-in",
};

export type SkillText = {
  name: string;
  description: string;
  version: string | null;
  body: string;
};

export function skillVersionLabel(version: string | null): string {
  const value = version?.trim();
  if (!value) return "No version";
  return /^v/i.test(value) ? value : `v${value}`;
}

export function isSkillId(value: string): boolean {
  return SKILL_ID.test(value);
}

export function parseSkillMarkdown(text: string): SkillText | null {
  const clean = text.replace(/^﻿/, "");
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const name = readScalar(match[1], "name")?.slice(0, 80);
  const description = readScalar(match[1], "description")?.slice(0, MAX_SKILL_DESCRIPTION);
  const version = readScalar(match[1], "version")?.slice(0, 40) ?? null;
  if (!name || !description) return null;
  return { name, description, version, body: clean.slice(match[0].length).trim() };
}

export function matchSkillInvocation<T extends { id: string; name: string }>(
  catalog: readonly T[],
  args: string,
): { skill: T; task: string } | { error: string } {
  const text = args.trim();
  if (!text) return { error: "Name a skill. Usage: /skills <skill-id> <task>" };
  if (catalog.length === 0) return { error: "No skills are installed." };
  const lower = text.toLowerCase();
  let best: { skill: T; task: string; length: number } | null = null;
  let ambiguous = false;
  for (const skill of catalog) {
    for (const key of [skill.id, skill.name.trim()]) {
      if (!key) continue;
      const needle = key.toLowerCase();
      if (lower !== needle && !lower.startsWith(`${needle} `) && !lower.startsWith(`${needle}\n`)) {
        continue;
      }
      const task = text.slice(needle.length).trim();
      if (!best || needle.length > best.length) {
        best = { skill, task, length: needle.length };
        ambiguous = false;
      } else if (needle.length === best.length && skill.id !== best.skill.id) {
        ambiguous = true;
      }
    }
  }
  if (!best) return { error: `No skill matches "${text.split(/\s+/)[0]}".` };
  if (ambiguous) return { error: "More than one skill matches. Use the skill id." };
  return { skill: best.skill, task: best.task };
}

export function filterSkills<T extends { id: string; name: string; description: string }>(
  skills: readonly T[],
  query: string,
): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...skills];
  return skills.filter((skill) => {
    const text = `${skill.id} ${skill.name} ${skill.description}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function usedSkillsPrompt(
  skills: readonly { id: string; name: string; description: string }[],
): string {
  const lines = skills.map((skill) => {
    const description = skill.description.replace(/\s+/g, " ").trim();
    const short = description.length > 160 ? `${description.slice(0, 160)}…` : description;
    return `- ${skill.id} (${skill.name}): ${short}`;
  });
  return [
    "Skills used earlier in this conversation are available, but their instructions are not loaded:",
    ...lines,
    "Call use_skill with one id only if the current message needs that skill. Do not load one just because it was used before, or for a follow-up the conversation already answers.",
  ].join("\n");
}

export function skillTurnPrompt(
  skill: { name: string; body: string },
  files: readonly SkillFile[] = [],
): string {
  const raw = skill.body.trim();
  const truncated = raw.length > MAX_SKILL_CHARS;
  const body = truncated ? raw.slice(0, MAX_SKILL_CHARS) : raw;
  const parts = [
    "The user invoked this skill for this message. Follow it when it applies. It does not override approval rules, tool limits, or project rules.",
    `### ${skill.name}\n${body}${truncated ? "\n…(truncated)" : ""}`,
  ];
  if (files.length > 0) {
    const shown = files.slice(0, 40);
    const lines = shown.map((file) => `- ${file.path}`);
    if (files.length > shown.length) lines.push(`- …and ${files.length - shown.length} more`);
    parts.push(
      [
        "Supporting files (read them with skill_read only when the skill asks for them):",
        ...lines,
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

function readScalar(front: string, key: string): string | null {
  const lines = front.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!match) continue;
    const rest = match[1].trim();
    if (rest.startsWith(">") || rest.startsWith("|")) {
      const folded: string[] = [];
      for (let next = index + 1; next < lines.length; next += 1) {
        if (lines[next].trim() === "") {
          folded.push("");
          continue;
        }
        if (!/^\s+\S/.test(lines[next])) break;
        folded.push(lines[next].trim());
      }
      const joined = (
        rest.startsWith(">") ? folded.join(" ").replace(/\s+/g, " ") : folded.join("\n")
      ).trim();
      return joined || null;
    }
    if (!rest) return null;
    return rest.replace(/^["']|["']$/g, "").trim() || null;
  }
  return null;
}
