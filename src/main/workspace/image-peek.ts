import fs from "fs";
import { imageMimeForPath } from "../../shared/image";
import type { WorkspaceImagePeek } from "../../shared/types";
import { relativeInside, resolveInside } from "../../tools/workspace";

const MAX_IMAGE_BYTES = 10_000_000;

export function readWorkspaceImage(workspaceDir: string, requested: string): WorkspaceImagePeek {
  if (!requested.trim()) throw new Error("Choose an image to open");
  const file = resolveInside(workspaceDir, requested);
  const mime = imageMimeForPath(requested);
  if (!mime) throw new Error("That file is not an image this app can preview");

  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new Error("That file was not found");
  }
  if (!stat.isFile()) throw new Error("That path is not a file");
  if (stat.size === 0) throw new Error("That image is empty");
  if (stat.size > MAX_IMAGE_BYTES) throw new Error("That image is too large to preview");

  const data = fs.readFileSync(file);
  return {
    path: relativeInside(workspaceDir, file),
    mime,
    dataUrl: `data:${mime};base64,${data.toString("base64")}`,
    bytes: stat.size,
  };
}
