import fs from "fs";
import os from "os";
import path from "path";
import { app, BrowserWindow, nativeTheme } from "electron";
import { BrowserManager } from "./browser/browser-manager";
import { CheckpointStore } from "./workspace/checkpoints";
import { AppDatabase } from "./db";
import { registerIpc } from "./ipc";
import { checkpointsDir, databasePath } from "./paths";
import { Runner } from "./chat/runner";
import { RoutineService } from "./routines/service";
import { Scheduler } from "./routines/scheduler";
import { stopClient } from "./copilot";
import { ensureWindowsToastShortcut } from "./routines/notify";
import { hasSecret, getSecret, secretKeys } from "./secrets";
import { logInfo, logJiraStatus, logWarn } from "./log";
import { appIconPath } from "./icon";
import { appUserModelId } from "./identity";
import { channels } from "../shared/channels";
import { inboxBadgeCount } from "../shared/inbox";
import { currentInbox } from "./routines/inbox";
import { createAppTray, setInboxBadge } from "./routines/tray";

app.setName("fid-coder");
nativeTheme.themeSource = "dark";
// Keep app data under the user's home folder by default. The environment
// variable remains available for tests and portable/custom locations.
const userData = path.resolve(process.env.FID_CODER_USER_DATA || path.join(os.homedir(), ".fid_coder_app"));
fs.mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
if (process.platform === "win32") {
  app.setAppUserModelId(appUserModelId());
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let db: AppDatabase | null = null;
  let scheduler: Scheduler | null = null;
  let runner: Runner | null = null;
  const browser = new BrowserManager();
  let shuttingDown = false;
  let inboxCount = 0;
  let tray: { update: () => void; destroy: () => void } | null = null;

  function showMainWindow(): void {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }

  function publishInbox(): void {
    if (!db || !runner) return;
    const view = currentInbox(db, runner.listPendingApprovals());
    inboxCount = inboxBadgeCount(view.unread, runner.pendingWaitingCount());
    setInboxBadge(mainWindow, inboxCount);
    tray?.update();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channels.inboxChanged);
    }
  }

  function openAgent(agentId: string): void {
    showMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channels.appOpenAgent, agentId);
    }
  }

  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(() => {
    db = new AppDatabase(databasePath());
    const checkpoints = new CheckpointStore(db, checkpointsDir());
    const activeRunner = new Runner(db, browser, checkpoints);
    runner = activeRunner;
    scheduler = new Scheduler(db, activeRunner);
    const routines = new RoutineService(db, scheduler);
    activeRunner.setRoutinePort(routines);
    activeRunner.setInboxHook(() => publishInbox());
    scheduler.setHooks({ onInbox: () => publishInbox(), onOpenAgent: openAgent });
    activeRunner.setSink((event) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channels.chatEvent, event);
      }
    });
    registerIpc({
      db,
      runner: activeRunner,
      scheduler,
      routines,
      browser,
      checkpoints,
      getWindow: () => mainWindow,
      noteInbox: () => publishInbox(),
    });
    ensureWindowsToastShortcut();
    logInfo(`Fid Coder started. appData=${userData}`);
    const jiraSite = db.getSetting("jira_site_url");
    const hasJiraToken = hasSecret(secretKeys.jira);
    let jiraTokenReadable = hasJiraToken;
    if (hasJiraToken) {
      try {
        getSecret(secretKeys.jira);
      } catch (error) {
        jiraTokenReadable = false;
        logWarn(
          `Jira token is saved but could not be decrypted: ` +
            `${error instanceof Error ? error.message : String(error)}. Save it again in Settings -> Jira.`,
        );
      }
    }
    logJiraStatus(
      { site: jiraSite, hasToken: hasJiraToken, readable: jiraTokenReadable },
      { force: true },
    );
    scheduler.reload();
    const activeScheduler = scheduler;
    tray = createAppTray({
      isPaused: () => activeScheduler.isPaused(),
      waiting: () => inboxCount,
      onOpen: () => showMainWindow(),
      onTogglePause: () => {
        activeScheduler.setPaused(!activeScheduler.isPaused());
        tray?.update();
      },
      onQuit: () => app.quit(),
    });
    publishInbox();
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
    runner?.clearAllQueues();
    runner?.denyAllApprovals("The app closed before approval.");
    runner?.dismissAllQuestions();
    runner?.dismissAllHandoffs();
    runner?.dismissAllSkillSaves();
    scheduler?.stop();
    tray?.destroy();
    tray = null;
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
    icon: appIconPath(),
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#2b2d30",
      symbolColor: "#c8cbd1",
      height: 36,
    },
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

  window.once("ready-to-show", () => {
    window.show();
  });

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
