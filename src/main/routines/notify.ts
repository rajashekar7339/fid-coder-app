import { app, Notification, shell } from "electron";
import fs from "fs";
import path from "path";
import { appIconIcoPath, appIconPath } from "../icon";
import { appIdentity } from "../identity";

let shortcutReady = false;

export function ensureWindowsToastShortcut(): boolean {
  if (process.platform !== "win32") return false;
  if (shortcutReady) return true;
  const identity = appIdentity();
  const shortcut = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    identity.shortcutName,
  );
  const root = findAppRoot(app.getAppPath());
  const options = {
    target: process.execPath,
    cwd: identity.dev ? root : undefined,
    args: identity.dev ? `"${root}"` : undefined,
    appUserModelId: identity.userModelId,
    description: identity.description,
    icon: appIconIcoPath(),
    iconIndex: 0,
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

export function notify(title: string, body: string, onClick?: () => void): void {
  ensureWindowsToastShortcut();
  if (!Notification.isSupported()) return;
  const toast = new Notification({
    title: title.slice(0, 64),
    body: body.slice(0, 240),
    icon: appIconPath(),
  });
  if (onClick) toast.on("click", () => onClick());
  toast.show();
}
