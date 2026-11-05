import { app } from "electron";
import path from "path";

const AGENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function userDataDir(): string {
  return app.getPath("userData");
}

export function databasePath(): string {
  return path.join(userDataDir(), "fid-coder.sqlite");
}

export function secretsPath(): string {
  return path.join(userDataDir(), "secrets.bin.json");
}

export function profileDir(agentId: string): string {
  if (!AGENT_ID.test(agentId)) {
    throw new Error("Invalid agent id");
  }
  return path.join(userDataDir(), "browser-profiles", agentId);
}

export function checkpointsDir(): string {
  return path.join(userDataDir(), "checkpoints");
}

export function skillsDir(): string {
  if (typeof app?.isPackaged !== "boolean" || typeof app.getAppPath !== "function") {
    return path.join(process.cwd(), "skills");
  }
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  return path.join(root, "skills");
}
