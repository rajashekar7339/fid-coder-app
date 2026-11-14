import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import {
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_SELECTION_CHARS,
  attachmentLabel,
  normalizeLineRange,
} from "../../shared/attachments";
import { imageMimeForPath } from "../../shared/image";
import type { Agent, AttachmentPick, MessageAttachment } from "../../shared/types";
import { relativeInside } from "../../tools/workspace";
import { resolveWorkspaceFile } from "./resolve-file";

const SUPPORTED_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

type CopilotAttachment =
  | { type: "blob"; data: string; mimeType: string; displayName: string }
  | {
      type: "selection";
      filePath: string;
      displayName: string;
      text: string;
      selection: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
    };

type BuiltAttachments = {
  sdk: CopilotAttachment[];
  stored: MessageAttachment[];
  prompt: string;
};

type BuiltOne = {
  sdk: CopilotAttachment | null;
  stored: MessageAttachment;
  prompt: string;
};

export function describeAttachmentFiles(paths: string[]): AttachmentPick {
  const attachments: MessageAttachment[] = [];
  const errors: string[] = [];
  for (const file of paths) {
    try {
      statFile(file);
      attachments.push({
        kind: "upload",
        path: path.resolve(file),
        name: path.basename(file),
      });
    } catch (error) {
      errors.push(`${path.basename(file)}: ${message(error)}`);
    }
  }
  return { attachments, errors };
}

/**
 * Code Puppy's rule: only images go to the model as binary attachments.
 * Text and code files are passed as workspace paths, and the agent reads them
 * with its own file tools. An upload from outside the workspace is copied to
 * `.fid/uploads/<id>/` first so those tools can reach it.
 */
export function buildCopilotAttachments(
  agent: Agent,
  refs: MessageAttachment[] | null | undefined,
): BuiltAttachments {
  if (!refs || refs.length === 0) return { sdk: [], stored: [], prompt: "" };
  const sdk: CopilotAttachment[] = [];
  const stored: MessageAttachment[] = [];
  const promptLines: string[] = [];
  for (const ref of refs) {
    const built = buildOne(agent, ref);
    if (built.sdk) sdk.push(built.sdk);
    stored.push(built.stored);
    if (built.prompt) promptLines.push(built.prompt);
  }
  return {
    sdk,
    stored,
    prompt: promptLines.length > 0 ? ["Attached files:", ...promptLines].join("\n") : "",
  };
}

function buildOne(agent: Agent, ref: MessageAttachment): BuiltOne {
  if (ref.kind === "selection") return buildSelection(agent, ref);
  if (ref.kind === "workspace") return buildWorkspaceFile(agent, ref);
  if (ref.kind === "upload") return buildUpload(agent, ref);
  throw new Error("Unknown attachment.");
}

function buildSelection(agent: Agent, ref: MessageAttachment): BuiltOne {
  if (!agent.workspaceDir) throw new Error("Pick a workspace folder to reference a file.");
  const resolved = resolveWorkspaceFile(agent.workspaceDir, ref.path);
  const lines = readLines(resolved.file);
  const range = normalizeLineRange(ref.startLine, ref.endLine, lines.length);
  if (!range) throw new Error("That file is empty.");
  const text = lines.slice(range.startLine - 1, range.endLine).join("\n");
  if (text.length > MAX_SELECTION_CHARS) {
    throw new Error("That selection is too large to attach.");
  }
  const stored: MessageAttachment = {
    kind: "selection",
    path: resolved.relative,
    name: path.basename(resolved.file),
    startLine: range.startLine,
    endLine: range.endLine,
  };
  return {
    sdk: {
      type: "selection",
      filePath: resolved.file,
      displayName: attachmentLabel(stored),
      text,
      selection: {
        start: { line: range.startLine - 1, character: 0 },
        end: { line: range.endLine - 1, character: lines[range.endLine - 1]?.length ?? 0 },
      },
    },
    stored,
    prompt: `- ${attachmentLabel(stored)} (selected lines)`,
  };
}

function buildWorkspaceFile(agent: Agent, ref: MessageAttachment): BuiltOne {
  if (!agent.workspaceDir) throw new Error("Pick a workspace folder to reference a file.");
  const resolved = resolveWorkspaceFile(agent.workspaceDir, ref.path);
  statFile(resolved.file);
  const mime = imageMimeForAttachment(resolved.file);
  const stored: MessageAttachment = {
    kind: "workspace",
    path: resolved.relative,
    name: path.basename(resolved.file),
  };
  if (mime) {
    return {
      sdk: blobAttachment(resolved.file, stored.name, mime),
      stored,
      prompt: `- ${stored.name} (image attachment)`,
    };
  }
  if (!canUseFileTools(agent)) {
    throw new Error(
      "This agent cannot read workspace files. Use an agent with file tools, or attach a PNG, JPEG, WebP, or GIF image up to 10 MB.",
    );
  }
  return {
    sdk: null,
    stored,
    prompt: `- ${stored.path} (workspace file)`,
  };
}

function buildUpload(agent: Agent, ref: MessageAttachment): BuiltOne {
  if (!path.isAbsolute(ref.path)) throw new Error("Choose that file again.");
  statFile(ref.path);
  const mime = imageMimeForAttachment(ref.path);
  const name = path.basename(ref.path);
  if (mime) {
    return {
      sdk: blobAttachment(ref.path, name, mime),
      stored: { kind: "upload", path: ref.path, name },
      prompt: `- ${name} (image attachment)`,
    };
  }
  if (!canUseFileTools(agent)) {
    throw new Error(
      "This agent cannot read files. Use an agent with a workspace and file tools, or attach a PNG, JPEG, WebP, or GIF image up to 10 MB.",
    );
  }
  const copied = copyUpload(agent.workspaceDir, ref.path, name);
  return {
    sdk: null,
    stored: {
      kind: "upload",
      path: copied.relative,
      name,
    },
    prompt: `- ${copied.relative} (uploaded file)`,
  };
}

function canUseFileTools(agent: Agent): agent is Agent & { workspaceDir: string } {
  return Boolean(agent.workspaceDir) && agent.toolProfile !== "browser";
}

function copyUpload(
  workspaceDir: string,
  source: string,
  name: string,
): { relative: string } {
  const uploads = path.join(workspaceDir, ".fid", "uploads");
  const folder = path.join(uploads, randomUUID());
  const destination = path.join(folder, path.basename(name) || "upload.txt");
  try {
    fs.mkdirSync(folder, { recursive: true });
    const ignore = path.join(uploads, ".gitignore");
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
    fs.copyFileSync(source, destination);
  } catch {
    throw new Error("Could not copy the uploaded file into the workspace.");
  }
  return { relative: relativeInside(workspaceDir, destination) };
}

function blobAttachment(
  file: string,
  displayName: string,
  mime: string,
): Extract<CopilotAttachment, { type: "blob" }> {
  return {
    type: "blob",
    data: fs.readFileSync(file).toString("base64"),
    mimeType: mime,
    displayName,
  };
}

function statFile(file: string): fs.Stats {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error("That file was not found.");
  }
  if (!stat.isFile()) throw new Error("That path is not a file.");
  return stat;
}

function imageMimeForAttachment(file: string): string | null {
  const mime = imageMimeForPath(file);
  if (!mime || !SUPPORTED_IMAGE_MIMES.has(mime)) return null;
  return statFile(file).size <= MAX_IMAGE_ATTACHMENT_BYTES ? mime : null;
}

function readLines(file: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error("That file could not be read.");
  }
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
