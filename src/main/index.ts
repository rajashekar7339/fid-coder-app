import path from "path";
import { app, BrowserWindow, nativeTheme } from "electron";
import { BrowserManager } from "./browser-manager";
import { CheckpointStore } from "./checkpoints";
import { AppDatabase } from "./db";
import { registerIpc } from "./ipc";
import { checkpointsDir, databasePath } from "./paths";
import { Runner } from "./runner";
import { Scheduler } from "./scheduler";
import { stopClient } from "./copilot";
import { ensureWindowsToastShortcut } from "./notify";
import { channels } from "../shared/channels";

app.setName("fid-coder");
nativeTheme.themeSource = "dark";
if (process.env.FID_CODER_USER_DATA) {
  app.setPath("userData", process.env.FID_CODER_USER_DATA);
}
if (process.platform === "win32") {
  app.setAppUserModelId("com.fidcoder.desktop");
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let db: AppDatabase | null = null;
  let scheduler: Scheduler | null = null;
  const browser = new BrowserManager();
  let shuttingDown = false;

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    db = new AppDatabase(databasePath());
    const checkpoints = new CheckpointStore(db, checkpointsDir());
    const runner = new Runner(db, browser, checkpoints);
    scheduler = new Scheduler(db, runner);
    runner.setSink((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channels.chatEvent, event);
      }
    });
    registerIpc({
      db,
      runner,
      scheduler,
      browser,
      checkpoints,
      getWindow: () => mainWindow,
    });
    ensureWindowsToastShortcut();
    scheduler.reload();
    mainWindow = createWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => {
    if (shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    void shutdown().finally(() => app.quit());
  });

  async function shutdown(): Promise<void> {
    scheduler?.stop();
    await browser.closeAll();
    await stopClient();
    db?.close();
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Fid Coder",
    backgroundColor: "#1e1f22",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  if (app.isPackaged) {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  } else {
    void window.loadURL("http://127.0.0.1:5173");
    if (process.env.FID_CODER_DEVTOOLS === "1") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  }
  return window;
}
