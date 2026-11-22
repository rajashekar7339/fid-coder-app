import { assertFactBudget, normalizeFactContent } from "../../shared/facts";
import type { Fact, FactInput, FactPatch } from "../../shared/types";
import type { AppDatabase } from "../db";

type SessionDrop = {
  dropSession(agentId: string): Promise<void>;
  isRunning?(agentId: string): boolean;
};

/**
 * Drop the cached session so the next turn rebuilds the system message with the
 * new facts. A turn that is already running keeps its session; the next turn
 * sees the changed facts and rebuilds on its own.
 */
async function dropFor(db: AppDatabase, runner: SessionDrop, agentId: string | null): Promise<void> {
  const ids = agentId ? [agentId] : db.listAgents().map((agent) => agent.id);
  for (const id of ids) {
    if (!runner.isRunning?.(id)) await runner.dropSession(id);
  }
}

export async function createFact(db: AppDatabase, runner: SessionDrop, input: FactInput): Promise<Fact> {
  const content = normalizeFactContent(input.content);
  const agentId = input.shared ? null : input.agentId?.trim() || null;
  if (!input.shared && !agentId) throw new Error("Agent is required");
  if (agentId && !db.getAgent(agentId)) throw new Error("Agent not found");
  const enabled = input.enabled !== false;
  assertFactBudget(db.listAllFacts(), { agentId, content, enabled });
  const fact = db.insertFact({ agentId, content, enabled });
  await dropFor(db, runner, fact.agentId);
  return fact;
}

export async function updateFact(db: AppDatabase, runner: SessionDrop, id: string, patch: FactPatch): Promise<Fact> {
  const current = db.getFact(id);
  if (!current) throw new Error("Fact not found");
  const content = patch.content === undefined ? current.content : normalizeFactContent(patch.content);
  const enabled = patch.enabled ?? current.enabled;
  if (content === current.content && enabled === current.enabled) return current;
  assertFactBudget(db.listAllFacts(), { id: current.id, agentId: current.agentId, content, enabled });
  const fact = db.updateFact(id, { content, enabled });
  await dropFor(db, runner, fact.agentId);
  return fact;
}

export async function removeFact(db: AppDatabase, runner: SessionDrop, id: string): Promise<Fact> {
  const fact = db.deleteFact(id);
  await dropFor(db, runner, fact.agentId);
  return fact;
}
