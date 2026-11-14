import fs from "fs";
import { imageMimeForPath } from "../../shared/image";
import type { WorkspaceImagePeek } from "../../shared/types";
import { resolveWorkspaceFile } from "./resolve-file";

const MAX_IMAGE_BYTES = 10_000_000;

export function readWorkspaceImage(workspaceDir: string, requested: string): WorkspaceImagePeek {
  if (!requested.trim()) throw new Error("Choose an image to open");
  const mime = imageMimeForPath(requested);
  if (!mime) throw new Error("That file is not an image this app can preview");
  const resolved = resolveWorkspaceFile(workspaceDir, requested);
  const file = resolved.file;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error("That file was not found");
  }
  if (stat.size === 0) throw new Error("That image is empty");
  if (stat.size > MAX_IMAGE_BYTES) throw new Error("That image is too large to preview");

  const data = fs.readFileSync(file);
  return {
    path: resolved.relative,
    mime,
    dataUrl: `data:${mime};base64,${data.toString("base64")}`,
    bytes: stat.size,
  };
}
