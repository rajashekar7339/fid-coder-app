import { app } from "electron";

export type AppIdentity = {
  dev: boolean;
  userModelId: string;
  shortcutName: string;
  description: string;
};

/**
 * Windows groups taskbar buttons and toast notifications by this id. Development
 * uses its own id and shortcut so the running dev app does not inherit the
 * Electron icon from the packaged app's Start Menu shortcut.
 */
export function appIdentity(): AppIdentity {
  const dev = !app.isPackaged;
  return {
    dev,
    userModelId: dev ? "com.fidcoder.desktop.dev" : "com.fidcoder.desktop",
    shortcutName: dev ? "Fid Coder (dev).lnk" : "Fid Coder.lnk",
    description: dev ? "Fid Coder (dev)" : "Fid Coder",
  };
}

export function appUserModelId(): string {
  return appIdentity().userModelId;
}
