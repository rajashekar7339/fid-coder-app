import path from "path";
import { app, nativeImage, type NativeImage } from "electron";

function iconDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app-icon")
    : path.resolve(__dirname, "../../assets/app-icon");
}

/**
 * The window and notification icon. This stays a PNG: Electron's Windows window
 * icon loader handles PNG reliably, while the multi-size ICO is for the shell,
 * the shortcut, and the packaged .exe.
 */
export function appIconPath(): string {
  return path.join(iconDir(), "icon.png");
}

/** The multi-size icon for a Windows shortcut or an embedded executable. */
export function appIconIcoPath(): string {
  return path.join(iconDir(), "icon.ico");
}

export function trayIconImage(): NativeImage {
  return nativeImage.createFromPath(path.join(iconDir(), "tray.png"));
}
