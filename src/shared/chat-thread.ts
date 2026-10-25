import type { Message } from "./types";

export type LiveTurn = {
  userText: string;
  assistant: string;
  toolLine: string | null;
  startedAt: number;
};

export type ProjectedThread = {
  messages: Message[];
  thinking: boolean;
  toolLine: string | null;
  streaming: boolean;
};

export type ThreadItem =
  | { kind: "message"; message: Message }
  | { kind: "tools"; id: string; calls: Message[] };

export function groupToolCalls(messages: Message[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  let calls: Message[] = [];
  const flush = () => {
    const first = calls[0];
    if (!first) return;
    items.push({ kind: "tools", id: `tools-${first.id}`, calls });
    calls = [];
  };
  for (const message of messages) {
    if (message.role === "tool") {
      calls.push(message);
      continue;
    }
    flush();
    items.push({ kind: "message", message });
  }
  flush();
  return items;
}

const MATCH_SKEW_MS = 2000;

function idle(messages: Message[]): ProjectedThread {
  return { messages, thinking: false, toolLine: null, streaming: false };
}

function matchingUserIndex(saved: Message[], live: LiveTurn): number {
  let found = -1;
  saved.forEach((message, index) => {
    if (message.role !== "user" || message.content !== live.userText) return;
    const created = Date.parse(message.createdAt);
    if (!Number.isFinite(created) || created < live.startedAt - MATCH_SKEW_MS) return;
    found = index;
  });
  return found;
}

export function liveTurnSettled(saved: Message[], live: LiveTurn): boolean {
  if (!live.userText) return false;
  const index = matchingUserIndex(saved, live);
  if (index < 0) return false;
  return saved.slice(index + 1).some((message) => message.role === "assistant");
}

export function userTurnAccepted(saved: Message[], text: string, startedAt: number): boolean {
  return liveTurnSettled(saved, { userText: text, assistant: "", toolLine: null, startedAt }) || matchingUserIndex(saved, {
    userText: text,
    assistant: "",
    toolLine: null,
    startedAt,
  }) >= 0;
}

export function projectThread(saved: Message[], live: LiveTurn | null, agentId: string): ProjectedThread {
  if (!live) return idle(saved);
  if (live.userText && liveTurnSettled(saved, live)) return idle(saved);

  const messages = saved.slice();
  const userListed = live.userText ? matchingUserIndex(saved, live) >= 0 : true;
  if (live.userText && !userListed) {
    messages.push({
      id: "pending-user",
      agentId,
      role: "user",
      content: live.userText,
      createdAt: new Date(live.startedAt).toISOString(),
    });
  }

  const streaming = live.assistant.length > 0;
  if (streaming) {
    messages.push({
      id: "live-assistant",
      agentId,
      role: "assistant",
      content: live.assistant,
      createdAt: "",
    });
  }

  const last = messages[messages.length - 1];
  const open = !last || last.role !== "assistant";
  return {
    messages,
    thinking: open && !streaming,
    toolLine: live.toolLine,
    streaming,
  };
}
