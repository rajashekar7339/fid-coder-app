import { app, Notification, shell } from "electron";
import fs from "fs";
import path from "path";

const APP_USER_MODEL_ID = "com.fidcoder.desktop";
let shortcutReady = false;

export function ensureWindowsToastShortcut(): boolean {
  if (process.platform !== "win32") return false;
  if (shortcutReady) return true;
  const shortcut = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Fid Coder.lnk",
  );
  const root = findAppRoot(app.getAppPath());
  const options = {
    target: process.execPath,
    cwd: app.isPackaged ? undefined : root,
    args: app.isPackaged ? undefined : `"${root}"`,
    appUserModelId: APP_USER_MODEL_ID,
    description: "Fid Coder",
  };
  const operation = fs.existsSync(shortcut) ? "replace" : "create";
  let ok = shell.writeShortcutLink(shortcut, operation, options);
  if (!ok && operation === "replace") ok = shell.writeShortcutLink(shortcut, "update", options);
  shortcutReady = ok;
  return ok;
}

function findAppRoot(start: string): string {
  let dir = path.resolve(start);
  for (let i = 0; i < 4; i += 1) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

export function notify(title: string, body: string): void {
  ensureWindowsToastShortcut();
  if (!Notification.isSupported()) return;
  const toast = new Notification({
    title: title.slice(0, 64),
    body: body.slice(0, 240),
  });
  toast.show();
}
