import fs from "fs";
import path from "path";
import { asRecord, requiredString } from "./args";
import type { AppTool } from "./types";

const MAX_READ = 100_000;
const MAX_WRITE = 200_000;

export const fileTools: AppTool[] = [
  {
    name: "file_read",
    description: "Read a text file inside this agent's workspace folder.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the workspace" } },
      required: ["path"],
    },
    handler: async (args, ctx) => {
      const file = workspaceFile(ctx.workspaceDir, requiredString(asRecord(args), "path"));
      const stat = fs.statSync(file);
      if (!stat.isFile()) throw new Error("Path is not a file");
      if (stat.size > MAX_READ) throw new Error("File is too large to read");
      return fs.readFileSync(file, "utf8");
    },
  },
  {
    name: "file_write",
    description: "Write a text file inside this agent's workspace folder. Overwrites an existing file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const content = record.content;
      if (typeof content !== "string") throw new Error("content must be a string");
      if (content.length > MAX_WRITE) throw new Error("content is too large");
      const file = workspaceFile(ctx.workspaceDir, requiredString(record, "path"));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, "utf8");
      return `wrote ${path.basename(file)} (${content.length} chars)`;
    },
  },
];

function workspaceFile(root: string | null, requested: string): string {
  if (!root) throw new Error("Pick a workspace folder for this agent first");
  const target = path.resolve(root, requested);
  const relative = path.relative(path.resolve(root), target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the workspace folder");
  }
  return target;
}
