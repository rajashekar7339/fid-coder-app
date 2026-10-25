import { asRecord, optionalString, requiredString } from "./args";
import type { AppTool } from "./types";

export const taskTools: AppTool[] = [
  {
    name: "task_list",
    description: "List this agent's tasks. Done tasks are included and marked.",
    parameters: { type: "object", properties: {} },
    handler: async (_args, ctx) => {
      const tasks = ctx.tasks.listTasks(ctx.agentId);
      if (tasks.length === 0) return "No tasks.";
      return tasks
        .map((task) => `- [${task.done ? "x" : " "}] ${task.id} ${task.title}${task.dueAt ? ` (due ${task.dueAt})` : ""}`)
        .join("\n");
    },
  },
  {
    name: "task_add",
    description: "Add a task. dueAt is an optional ISO date-time.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        dueAt: { type: "string" },
      },
      required: ["title"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const title = requiredString(record, "title");
      const dueAt = optionalString(record, "dueAt");
      if (dueAt && Number.isNaN(Date.parse(dueAt))) throw new Error("dueAt must be an ISO date-time");
      const task = ctx.tasks.addTask({ agentId: ctx.agentId, title, dueAt });
      return `added ${task.id}: ${task.title}`;
    },
  },
  {
    name: "task_complete",
    description: "Mark a task done or not done. id comes from task_list.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        done: { type: "boolean" },
      },
      required: ["id"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const id = requiredString(record, "id");
      const owner = ctx.tasks.getTaskAgentId(id);
      if (owner !== ctx.agentId) throw new Error("Task not found for this agent");
      const done = record.done == null ? true : record.done === true;
      ctx.tasks.setTaskDone(id, done);
      return done ? `completed ${id}` : `reopened ${id}`;
    },
  },
];
