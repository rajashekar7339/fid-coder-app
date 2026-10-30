import type { PlanStep, PlanStepStatus } from "../shared/types";
import { asRecord } from "./args";
import type { AppTool } from "./types";

const MAX_STEPS = 12;
const MAX_STEP_CHARS = 200;

const STATUSES: PlanStepStatus[] = ["pending", "in_progress", "done"];

export const planTools: AppTool[] = [
  {
    name: "set_plan",
    description:
      "Update the plan shown to the user. Call it first for a task with three or more steps, then again whenever a step starts or finishes. Send the complete list every time. Mark the step you are working on in_progress and finished steps done. Keep at most one step in_progress. Skip it for simple one-step requests.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "The full plan, in order",
          items: {
            type: "object",
            properties: {
              step: { type: "string", description: "Short step description" },
              status: { type: "string", enum: STATUSES },
            },
            required: ["step", "status"],
          },
        },
      },
      required: ["steps"],
    },
    handler: async (args, ctx) => {
      const steps = readSteps(asRecord(args).steps);
      ctx.onPlan?.(steps);
      return render(steps);
    },
  },
];

function readSteps(value: unknown): PlanStep[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("steps must be a non-empty array");
  if (value.length > MAX_STEPS) throw new Error(`A plan can have at most ${MAX_STEPS} steps`);
  let active = 0;
  const steps = value.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Step ${index + 1} must be an object`);
    const record = item as { step?: unknown; status?: unknown };
    const text = typeof record.step === "string" ? record.step.trim() : "";
    if (!text) throw new Error(`Step ${index + 1} needs text`);
    if (text.length > MAX_STEP_CHARS) throw new Error(`Step ${index + 1} is too long`);
    const status = record.status;
    if (status !== "pending" && status !== "in_progress" && status !== "done") {
      throw new Error(`Step ${index + 1} needs status pending, in_progress, or done`);
    }
    if (status === "in_progress") active += 1;
    return { text, status: status as PlanStepStatus };
  });
  if (active > 1) throw new Error("Mark at most one step in_progress");
  return steps;
}

function render(steps: PlanStep[]): string {
  const lines = steps.map((step, index) => {
    const mark = step.status === "done" ? "[done]" : step.status === "in_progress" ? "[now]" : "[ ]";
    return `${index + 1}. ${mark} ${step.text}`;
  });
  return `Plan updated:\n${lines.join("\n")}`;
}
