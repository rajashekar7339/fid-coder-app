import type { Message, MessageRole } from "./types";

export type HistorySearchOptions = {
  query?: string;
  from?: string;
  to?: string;
  role?: MessageRole | "all";
  limit?: number;
};

export type HistoryContextOptions = {
  from?: string;
  to?: string;
  limit?: number;
  includeTools?: boolean;
};

export type HistoryTurnSummary = {
  id: string;
  source: string;
  startedAt: string;
  endedAt: string | null;
  status: string | null;
  messages: number;
};

export type HistoryTurnDetail = {
  turn: HistoryTurnSummary;
  messages: Message[];
};

export type HistoryPort = {
  search(options: HistorySearchOptions): Promise<Message[]>;
  first(limit: number): Promise<Message[]>;
  turn(turnId: string): Promise<HistoryTurnDetail | null>;
  context(options: HistoryContextOptions): Promise<Message[]>;
};
