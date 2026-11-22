import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from "electron";
import { trayIconImage } from "../icon";

let dot: NativeImage | null = null;

function dotImage(): NativeImage {
  if (dot) return dot;
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const on = dx * dx + dy * dy <= 36;
      const offset = (y * size + x) * 4;
      buffer[offset] = on ? 0x78 : 0;
      buffer[offset + 1] = on ? 0xf8 : 0;
      buffer[offset + 2] = on ? 0xd8 : 0;
      buffer[offset + 3] = on ? 255 : 0;
    }
  }
  dot = nativeImage.createFromBitmap(buffer, { width: size, height: size, scaleFactor: 1 });
  return dot;
}

export function setInboxBadge(window: BrowserWindow | null, count: number): void {
  const safe = Math.max(0, Math.floor(count));
  app.setBadgeCount(safe);
  if (!window || window.isDestroyed() || process.platform !== "win32") return;
  if (safe === 0) {
    window.setOverlayIcon(null, "");
    return;
  }
  window.setOverlayIcon(dotImage(), `${safe} waiting`);
}

export function createAppTray(actions: {
  isPaused: () => boolean;
  waiting: () => number;
  onOpen: () => void;
  onTogglePause: () => void;
  onQuit: () => void;
}): { update: () => void; destroy: () => void } {
  const icon = trayIconImage();
  const tray = new Tray(icon.isEmpty() ? dotImage() : icon);
  const update = () => {
    const paused = actions.isPaused();
    const waiting = actions.waiting();
    tray.setToolTip(waiting > 0 ? `Fid Coder, ${waiting} waiting` : "Fid Coder");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open", click: actions.onOpen },
        { label: paused ? "Resume routines" : "Pause all routines", click: actions.onTogglePause },
        { type: "separator" },
        { label: "Quit", click: actions.onQuit },
      ]),
    );
  };
  update();
  tray.on("click", actions.onOpen);
  return {
    update,
    destroy: () => tray.destroy(),
  };
}
