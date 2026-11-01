import type { HistoryPort, HistoryTurnSummary } from "../../shared/history";
import type { AppDatabase, TurnRecord } from "../db";

export function createHistoryPort(db: AppDatabase, agentId: string): HistoryPort {
  return {
    async search(options) {
      return db.searchMessages(agentId, options);
    },
    async first(limit) {
      return db.firstUserMessages(agentId, limit);
    },
    async turn(turnId) {
      const turn = db.getTurn(turnId);
      if (!turn || turn.agentId !== agentId) return null;
      const messages = db.listTurnMessages(agentId, turnId);
      return { turn: summaryOf(turn, messages.length), messages };
    },
    async context(options) {
      return db.contextMessages(agentId, options);
    },
  };
}

function summaryOf(turn: TurnRecord, messages: number): HistoryTurnSummary {
  return {
    id: turn.id,
    source: turn.source,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    status: turn.status,
    messages,
  };
}
