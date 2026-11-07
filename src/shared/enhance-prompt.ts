export const ENHANCE_DRAFT_CHARS = 8_000;
export const ENHANCE_OUTPUT_CHARS = 1_500;
export const ENHANCE_CONTEXT_MESSAGES = 4;
export const ENHANCE_CONTEXT_CHARS = 500;
export const ENHANCE_TIMEOUT_MS = 20_000;
export const ENHANCE_MODEL_TTL_MS = 5 * 60 * 1000;

export const ENHANCE_SYSTEM = [
  "You tighten a chat draft for a coding agent.",
  "Reply with the rewritten draft only.",
  "Keep the same intent and the same language.",
  "Make it shorter and specific.",
  "Keep paths, error text, quotes, and slash commands unchanged.",
  "Do not invent files, APIs, or acceptance criteria.",
  "Do not add a role, XML tags, or chain-of-thought instructions.",
].join("\n");

const CHEAP_MODEL_RANK: { pattern: RegExp; rank: number }[] = [
  { pattern: /(?:^|[^a-z0-9])mini(?:[^a-z0-9]|$)/i, rank: 0 },
  { pattern: /(?:^|[^a-z0-9])flash(?:[^a-z0-9]|$)/i, rank: 1 },
  { pattern: /(?:^|[^a-z0-9])haiku(?:[^a-z0-9]|$)/i, rank: 2 },
];

export type EnhanceResult =
  | { status: "skipped"; text: string; reason: string }
  | { status: "enhanced"; text: string };

export type EnhancePlan =
  | { status: "skipped"; text: string; reason: string }
  | { status: "ready"; prompt: string };

type TranscriptRow = {
  role: string;
  content: string;
};

type NamedModel = {
  id: string;
  name: string;
};

export function prepareEnhance(input: {
  text: string;
  running: boolean;
  messages: TranscriptRow[];
  isCommand?: (text: string) => boolean;
}): EnhancePlan {
  const text = input.text.trim();
  if (!text) throw new Error("Message is empty");
  if (input.running) return { status: "skipped", text, reason: "Wait until the agent finishes." };
  if (input.isCommand?.(text)) return { status: "skipped", text, reason: "Commands are sent as written." };
  return { status: "ready", prompt: buildEnhancePrompt(text, input.messages) };
}

export function cheapModelId(models: NamedModel[]): string {
  let best: { id: string; rank: number } | null = null;
  for (const model of models) {
    const hay = `${model.id} ${model.name}`;
    for (const candidate of CHEAP_MODEL_RANK) {
      if (!candidate.pattern.test(hay)) continue;
      if (!best || candidate.rank < best.rank) best = { id: model.id, rank: candidate.rank };
      break;
    }
  }
  return best?.id ?? "auto";
}

export function finishEnhance(draft: string, raw: string): EnhanceResult {
  const original = draft.trim();
  let text = unwrapEnhanceReply(raw);
  if (!text) throw new Error("Copilot returned an empty rewrite.");
  if (text.length > ENHANCE_OUTPUT_CHARS) text = text.slice(0, ENHANCE_OUTPUT_CHARS).trimEnd();
  if (text === original) return { status: "skipped", text: original, reason: "Already clear." };
  return { status: "enhanced", text };
}

function buildEnhancePrompt(draft: string, messages: TranscriptRow[]): string {
  const recent = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-ENHANCE_CONTEXT_MESSAGES)
    .map((message) => `${message.role}: ${clip(message.content, ENHANCE_CONTEXT_CHARS)}`);
  const parts: string[] = [];
  if (recent.length > 0) {
    parts.push(`Recent conversation (reference only; do not repeat it):\n${recent.join("\n")}`);
  }
  parts.push(`Draft:\n${clip(draft, ENHANCE_DRAFT_CHARS)}`);
  return parts.join("\n\n");
}

function unwrapEnhanceReply(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```[a-z]*\s*\n([\s\S]*?)\n?```$/i);
  if (fenced) text = (fenced[1] ?? "").trim();
  return text.replace(/^(?:enhanced prompt|rewritten prompt|rewrite|prompt)\s*:\s*/i, "").trim();
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}
