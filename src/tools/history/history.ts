import type { HistoryPort, HistoryTurnDetail } from "../../shared/history";
import type { Message, MessageRole } from "../../shared/types";
import { asRecord, optionalBoolean, optionalNumber, optionalString, requiredString } from "../args";
import type { AppTool, ToolContext } from "../types";

const MAX_OUTPUT = 20_000;

export const historyTools: AppTool[] = [
  {
    name: "history_first",
    description:
      "Read the oldest user messages in this agent's saved conversation. Use when the user asks for the first message or how the chat started. It starts at the beginning and includes old messages that have no turn id.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum old user messages. Default 1, max 10." },
      },
    },
    handler: async (args, ctx) => {
      const messages = await port(ctx).first(readLimit(optionalNumber(asRecord(args), "limit", 1), 1, 10));
      if (messages.length === 0) return "No user messages yet.";
      return [`First user messages (${messages.length}):`, ...messages.map((message) => formatMessage(message, 2_000))].join(
        "\n\n",
      );
    },
  },
  {
    name: "history_search",
    description:
      "Search this agent's saved conversation history by text and/or date. Use this before asking the user to repeat an older task, issue, or decision. Returns compact matches with timestamps and turn ids; call history_turn to expand a turn.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to find. Omit to search by date only." },
        from: { type: "string", description: "ISO date or date-time, inclusive. A date-only value covers that local day." },
        to: { type: "string", description: "ISO date or date-time, inclusive. A date-only value covers that local day." },
        role: {
          type: "string",
          enum: ["user", "assistant", "tool", "all"],
          description: "Message role. Default all.",
        },
        limit: { type: "number", description: "Maximum matches. Default 20, max 50." },
      },
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const query = optionalString(record, "query");
      const from = readDate(optionalString(record, "from"), false);
      const to = readDate(optionalString(record, "to"), true);
      if (!query && !from && !to) throw new Error("Pass query, from, or to");
      const role = readRole(optionalString(record, "role"));
      const limit = readLimit(optionalNumber(record, "limit", 20), 20, 50);
      const messages = await port(ctx).search({ query: query ?? undefined, from, to, role, limit });
      if (messages.length === 0) return "No matching messages.";
      return joinCapped([`Matches (${messages.length}):`, ...messages.map((message) => formatMessage(message, 800))]);
    },
  },
  {
    name: "history_turn",
    description:
      "Read one saved turn by id, including its user, assistant, and tool messages. Use after history_search finds a turn. Old messages without a turn id are read with history_search or history_context.",
    parameters: {
      type: "object",
      properties: {
        turnId: { type: "string", description: "Turn id from history_search" },
      },
      required: ["turnId"],
    },
    handler: async (args, ctx) => {
      const turnId = requiredString(asRecord(args), "turnId");
      if (turnId.length > 80) throw new Error("turnId is too long");
      const detail = await port(ctx).turn(turnId);
      if (!detail) throw new Error("Turn not found for this agent");
      return formatTurn(detail);
    },
  },
  {
    name: "history_context",
    description:
      "Load saved messages from a date or time range in chronological order. Use for a focused old window, including messages without a turn id. Output is capped.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO date or date-time, inclusive. A date-only value covers that local day." },
        to: { type: "string", description: "ISO date or date-time, inclusive. A date-only value covers that local day." },
        limit: { type: "number", description: "Maximum messages. Default 40, max 100." },
        includeTools: { type: "boolean", description: "Include tool output. Default false." },
      },
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const from = readDate(optionalString(record, "from"), false);
      const to = readDate(optionalString(record, "to"), true);
      if (!from && !to) throw new Error("Pass from or to");
      const messages = await port(ctx).context({
        from,
        to,
        limit: readLimit(optionalNumber(record, "limit", 40), 40, 100),
        includeTools: optionalBoolean(record, "includeTools"),
      });
      if (messages.length === 0) return "No messages in that range.";
      return joinCapped([
        `Messages (${messages.length}) from ${from ?? "start"} to ${to ?? "end"}:`,
        ...messages.map((message) => formatMessage(message, message.role === "tool" ? 600 : 1_000)),
      ]);
    },
  },
];

function port(ctx: ToolContext): HistoryPort {
  if (!ctx.history) throw new Error("Conversation history is unavailable");
  return ctx.history;
}

function readRole(value: string | null): MessageRole | "all" {
  if (!value) return "all";
  if (value === "user" || value === "assistant" || value === "tool" || value === "all") return value;
  throw new Error("role must be user, assistant, tool, or all");
}

function readDate(value: string | null, end: boolean): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const local = new Date(
      year,
      month - 1,
      day,
      end ? 23 : 0,
      end ? 59 : 0,
      end ? 59 : 0,
      end ? 999 : 0,
    );
    if (!Number.isFinite(local.getTime())) throw new Error("from/to must be an ISO date or date-time");
    return local.toISOString();
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("from/to must be an ISO date or date-time");
  return date.toISOString();
}

function readLimit(value: number, fallback: number, max: number): number {
  const numeric = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(max, numeric));
}

function formatMessage(message: Message, max: number): string {
  const turn = message.turnId ? ` turn ${message.turnId.slice(0, 8)}` : "";
  return `[${message.createdAt}] ${message.role}${turn}: ${clip(message.content, max) || "(empty)"}`;
}

function formatTurn(detail: HistoryTurnDetail): string {
  const turn = detail.turn;
  const header = `Turn ${turn.id}\n${turn.startedAt} -> ${turn.endedAt ?? "open"} | ${turn.source} | ${turn.status ?? "running"} | ${turn.messages} messages`;
  if (detail.messages.length === 0) return `${header}\n\n(no messages)`;
  return joinCapped([
    header,
    ...detail.messages.map((message) => formatMessage(message, message.role === "tool" ? 800 : 2_000)),
  ]);
}

function joinCapped(parts: string[]): string {
  const text = parts.join("\n\n");
  return text.length <= MAX_OUTPUT ? text : `${text.slice(0, MAX_OUTPUT)}\n…truncated`;
}

function clip(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max).trimEnd()}…`;
}
