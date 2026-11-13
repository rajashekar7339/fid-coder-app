import {
  buildRoutineDraft,
  routineCreatedText,
  routineListText,
  type RoutineToolRequest,
} from "../../shared/routine-schedule";
import { asRecord, optionalBoolean, optionalString, requiredString } from "../args";
import type { AppTool, RoutinePort, ToolContext } from "../types";

export const routineTools: AppTool[] = [
  {
    name: "routine_list",
    description:
      "List this agent's routines with their ids, when they run, next runs, and instructions. Use it when the user asks what routines exist, or before cancelling a routine. Read-only.",
    parameters: { type: "object", properties: {} },
    handler: async (_args, ctx) => routineListText(port(ctx).list(ctx.agentId)),
  },
  {
    name: "routine_create",
    description:
      "Create the routine requested by /routine for this agent. The instruction runs later as a new turn with this agent's tools, so it can run a command, check a ticket, or do a review. If this agent has no shell tools, the routine should do browser or Jira work instead of a command. Call this only when the user sends /routine; never create a routine on your own initiative. Times are local 24-hour HH:MM. Leave frequency out when the user gives only a time: it defaults to one run at the next occurrence. Use date only for a one-time run. State the timing and next run in your reply.",
    parameters: {
      type: "object",
      properties: {
        instruction: {
          type: "string",
          description: "What the agent should do when the routine runs. Write it as a chat message.",
        },
        name: { type: "string", description: "Short name. Omit to derive one from the instruction." },
        frequency: {
          type: "string",
          enum: ["once", "daily", "weekdays", "weekly", "custom"],
          description: "Default once. Use daily, weekdays, or weekly for a repeating routine.",
        },
        time: { type: "string", description: "Local 24-hour time such as 16:00. Required unless custom." },
        date: {
          type: "string",
          description: "Local YYYY-MM-DD for a one-time run. Omit to use the next occurrence of the time.",
        },
        weekday: {
          type: "string",
          enum: ["0", "1", "2", "3", "4", "5", "6"],
          description: "For weekly routines. 0 is Sunday; omit for Monday.",
        },
        cron: { type: "string", description: "Five-field cron expression. Only for custom." },
        notify: {
          type: "boolean",
          description: "Show a Windows notification when the run finishes, fails, or needs approval. Default true.",
        },
      },
      required: ["instruction"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const request: RoutineToolRequest = {
        instruction: requiredString(record, "instruction"),
        name: optionalString(record, "name"),
        frequency: optionalString(record, "frequency"),
        time: optionalString(record, "time"),
        date: optionalString(record, "date"),
        weekday: optionalString(record, "weekday"),
        cron: optionalString(record, "cron"),
        notify: record.notify === undefined ? undefined : optionalBoolean(record, "notify"),
      };
      const draft = buildRoutineDraft(request);
      return routineCreatedText(port(ctx).create(ctx.agentId, draft));
    },
  },
  {
    name: "routine_delete",
    description:
      "Delete one of this agent's routines by id. Use routine_list first and read the id from the result; do not guess. Only this agent's routines can be deleted.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Routine id from routine_list" },
      },
      required: ["id"],
    },
    handler: async (args, ctx) => {
      const id = requiredString(asRecord(args), "id");
      const routine = port(ctx).remove(ctx.agentId, id);
      return `Deleted routine "${routine.name}".`;
    },
  },
];

function port(ctx: ToolContext): RoutinePort {
  if (!ctx.routines) throw new Error("Routines are not available for this agent");
  return ctx.routines;
}
