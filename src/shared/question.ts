import type { QuestionOutcome, QuestionReply } from "./types";

export const QUESTION_TIMEOUT_MS = 2 * 60 * 1000;
export const QUESTION_MAX_LENGTH = 400;
export const CHOICE_MAX_LENGTH = 80;
export const OTHER_MAX_LENGTH = 400;
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 4;

export const QUESTION_HINT =
  "When you need a preference you cannot find in the workspace or this conversation, call ask_user once with one question and two to four short choices. Do not use it for a fact you can look up. If it reports no answer, continue and do not ask again.";

export const NO_ANSWER_TEXT = "No answer. Continue with what you already know. Do not ask again.";

export type AskUserRequest = {
  question: string;
  choices: string[];
};

export function parseAskUserArgs(args: unknown): AskUserRequest {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object");
  }
  const record = args as Record<string, unknown>;
  if (typeof record.question !== "string" || !record.question.trim()) {
    throw new Error("Missing question");
  }
  const question = record.question.trim().replace(/\s+/g, " ");
  if (question.length > QUESTION_MAX_LENGTH) throw new Error("Question is too long");
  if (!Array.isArray(record.choices)) throw new Error("Ask with two to four choices");
  const choices = record.choices.map((choice) => {
    if (typeof choice !== "string") throw new Error("Each choice must be text");
    return choice.trim().replace(/\s+/g, " ");
  }).filter(Boolean);
  if (choices.length < MIN_CHOICES || choices.length > MAX_CHOICES) {
    throw new Error("Ask with two to four choices");
  }
  if (choices.some((choice) => choice.length > CHOICE_MAX_LENGTH)) {
    throw new Error("A choice is too long");
  }
  const seen = new Set<string>();
  for (const choice of choices) {
    const key = choice.toLowerCase();
    if (seen.has(key)) throw new Error("Choices must be different");
    seen.add(key);
  }
  return { question, choices };
}

export function parseQuestionReply(value: unknown): QuestionReply {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing answer");
  const record = value as Record<string, unknown>;
  if (record.kind === "skip") return { kind: "skip" };
  if (record.kind === "choice") {
    if (typeof record.index !== "number" || !Number.isInteger(record.index) || record.index < 0) {
      throw new Error("Missing choice");
    }
    return { kind: "choice", index: record.index };
  }
  if (record.kind === "other") {
    if (typeof record.text !== "string") throw new Error("Missing answer");
    return { kind: "other", text: record.text };
  }
  throw new Error("Unknown answer");
}

export function formatQuestionResult(outcome: QuestionOutcome): string {
  if (!outcome.answered || !outcome.text) return NO_ANSWER_TEXT;
  if (outcome.via === "other") return `The user answered in their own words: ${outcome.text}`;
  return `The user chose: ${outcome.text}`;
}
