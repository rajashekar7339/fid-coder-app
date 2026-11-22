// Deterministic Electron UI test for one-time and repeating routines.
//
// Usage:
//   npm run test:routines
//
// No Copilot turn is needed. The test seeds a temporary database with a
// repeating routine and a one-time routine, then drives the Routines dialog.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-routines-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Release desk";
const clean = process.env.FID_CLEAN === "1";
const slowMs = Number(process.env.FID_E2E_SLOW_MS || 0);
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");
const { nextRunIso } = require("../../dist/main/routines/cron.js");
const { localDateText } = require("../../dist/shared/routine-schedule.js");

const results = [];
let vite = null;
let app = null;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function pause(ms = 8) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function watch(ms = slowMs) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(16, 0, 0, 0);
  return date;
}

async function seed() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Seeded routines",
    systemPrompt: "Keep replies short.",
    workspaceDir: workspace,
    model: "auto",
    toolProfile: "developer",
    readOnly: false,
    memoryEnabled: false,
  });

  const weekday = db.createRoutine(
    {
      agentId: agent.id,
      name: "Weekday sweep",
      prompt: "Check the open tickets.",
      cron: "0 9 * * 1-5",
      once: false,
      runAt: null,
      enabled: true,
      notify: true,
      readOnly: true,
    },
    nextRunIso("0 9 * * 1-5"),
  );
  const finished = db.startRoutineRun({
    routineId: weekday.id,
    agentId: agent.id,
    trigger: "schedule",
    readOnly: true,
  });
  db.finishRoutineRun(finished.id, { status: "ok", output: "Three tickets are waiting." });
  db.markRoutineRun(weekday.id, "ok", weekday.nextRunAt);
  db.addInboxItem({
    agentId: agent.id,
    kind: "routine",
    refId: finished.id,
    title: "Weekday sweep",
    body: "Completed. Three tickets are waiting.",
  });
  db.addInboxItem({
    agentId: agent.id,
    kind: "turn",
    refId: "turn-build",
    title: "Build failed",
    body: "The compile step failed.",
  });

  const other = db.createAgent({
    name: "Night desk",
    description: "Second agent",
    systemPrompt: "Keep replies short.",
    workspaceDir: workspace,
    model: "auto",
    toolProfile: "developer",
    readOnly: false,
    memoryEnabled: false,
  });
  const nightly = db.createRoutine(
    {
      agentId: other.id,
      name: "Nightly report",
      prompt: "Summarize the day.",
      cron: "0 2 * * *",
      once: false,
      runAt: null,
      enabled: false,
      notify: false,
      readOnly: false,
    },
    nextRunIso("0 2 * * *"),
  );

  const onceDate = futureDate(2);
  const onceRun = onceDate.toISOString();
  db.createRoutine(
    {
      agentId: agent.id,
      name: "Once reminder",
      prompt: "Remind me to run the release checks.",
      cron: `${onceDate.getMinutes()} ${onceDate.getHours()} ${onceDate.getDate()} ${onceDate.getMonth() + 1} *`,
      once: true,
      runAt: onceRun,
      enabled: true,
      notify: true,
    },
    onceRun,
  );

  db.addMessage(agent.id, "user", "Show me what is scheduled.");
  db.addMessage(agent.id, "assistant", "You have a weekday sweep and a one-time reminder.");
  db.close();
  return {
    agentId: agent.id,
    otherAgentId: other.id,
    weekdayId: weekday.id,
    nightlyId: nightly.id,
    onceDate: localDateText(onceDate),
  };
}

async function viteRunning() {
  try {
    const response = await fetch("http://127.0.0.1:5173", { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureVite() {
  if (await viteRunning()) {
    console.log("vite: reusing the server on 5173");
    return;
  }
  let log = "";
  vite = spawn(
    process.execPath,
    [path.join(appDir, "node_modules", "vite", "bin", "vite.js"), "--port", "5173", "--strictPort"],
    { cwd: appDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  vite.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  vite.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await viteRunning()) {
      console.log("vite: started on 5173");
      return;
    }
    await pause(250);
  }
  console.log(log.slice(-3000));
  throw new Error("Vite did not start on 5173");
}

async function shot(page, name) {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("  shot:", file);
}

async function ensureAgent(page) {
  await page.waitForSelector(".agent-row", { timeout: 30_000 });
  const title = await page.locator(".chat-title h1").first().innerText().catch(() => "");
  if (title.trim() === agentName) return;
  await page.locator(".agent-row").filter({ hasText: agentName }).first().click();
  await page.waitForFunction(
    (name) => document.querySelector(".chat-title h1")?.textContent?.trim() === name,
    agentName,
    { timeout: 15_000 },
  );
}

async function openRoutines(page) {
  if (!(await page.locator(".agent-desk").count())) {
    await page.locator('button[aria-label="Show agent desk"]').click();
    await page.waitForSelector(".agent-desk", { timeout: 10_000 });
  }
  await page.getByRole("button", { name: "Manage routines" }).click();
  await page.waitForSelector(".routines-modal", { timeout: 15_000 });
  await watch();
}

function request(agent, id, createdAt) {
  return {
    id,
    agentId: agent.id,
    agentName: agent.name,
    createdAt,
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
  };
}

async function installBoardStubs() {
  await app.evaluate(({ ipcMain }) => {
    const state = { approval: null, question: null, handoff: null, run: null };
    globalThis.__fidNeedsYou = state;
    ipcMain.removeHandler("chat:approval");
    ipcMain.handle("chat:approval", (_event, id, action) => {
      state.approval = { id, action };
      return true;
    });
    ipcMain.removeHandler("chat:question");
    ipcMain.handle("chat:question", (_event, id, reply) => {
      state.question = { id, reply };
      return true;
    });
    ipcMain.removeHandler("browser:handoff-done");
    ipcMain.handle("browser:handoff-done", (_event, id) => {
      state.handoff = id;
      return true;
    });
    ipcMain.removeHandler("routines:run");
    ipcMain.handle("routines:run", (_event, id) => {
      state.run = id;
      return { id };
    });
  });
}

async function boardState() {
  return app.evaluate(() => globalThis.__fidNeedsYou);
}

async function sendBoardEvent(event) {
  await app.evaluate(({ BrowserWindow }, next) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("chat:event", next);
  }, event);
}

async function main() {
  const { agentId, otherAgentId, weekdayId, nightlyId, onceDate } = await seed();
  await ensureVite();
  try {
    app = await electron.launch({
      executablePath: path.join(appDir, "node_modules", "electron", "dist", "electron.exe"),
      args: ["."],
      cwd: appDir,
      env: { ...process.env, FID_CODER_USER_DATA: userData },
      timeout: 60_000,
    });
    const page = await app.firstWindow({ timeout: 60_000 });
    page.on("pageerror", (error) => console.log("[pageerror]", error.message));
    await page.waitForSelector(".app-shell", { timeout: 60_000 });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 980);
    });
    await ensureAgent(page);
    await watch(1200);

    const deskText = await page.locator(".agent-desk").innerText();
    check("the desk lists both routines", /Weekday sweep/.test(deskText) && /Once reminder/.test(deskText));
    check("the desk labels the one-time routine", /Once ·/.test(deskText), deskText.replace(/\s+/g, " ").slice(0, 160));
    check("the desk shows the last completed run", /Completed/.test(deskText), deskText.replace(/\s+/g, " ").slice(0, 200));
    await shot(page, "01-desk");

    await openRoutines(page);
    const navText = await page.locator(".routines-nav-list").innerText();
    check("the dialog lists the repeating routine", /Weekday sweep/.test(navText) && /Weekdays at 9:00/.test(navText));
    check("the dialog lists the one-time routine", /Once reminder/.test(navText) && /Once ·/.test(navText));
    check(
      "the dialog has Routines and History tabs",
      (await page.locator(".routines-view-tab").allInnerTexts()).join(" ") === "Routines History",
    );
    await shot(page, "02-routines-list");

    const instruction = page.locator(".routines-modal").getByLabel("Instruction");
    const originalInstruction = await instruction.inputValue();
    await instruction.fill("Unsaved draft survives history.");

    await page.locator(".routines-modal").getByRole("button", { name: "History", exact: true }).click();
    await page.waitForSelector(".routine-history-excerpt", { timeout: 10_000 });
    check(
      "History does not highlight a routine",
      (await page.locator(".routines-nav-item.is-active").count()) === 0,
    );
    check(
      "history has a refresh action",
      (await page.getByRole("button", { name: "Refresh history" }).count()) === 1,
    );
    const historyText = await page.locator(".routine-history").innerText();
    check(
      "history shows the run excerpt",
      /Weekday sweep/.test(historyText) &&
        /Completed/.test(historyText) &&
        /Scheduled/.test(historyText) &&
        /Look and report/.test(historyText) &&
        /Three tickets are waiting/.test(historyText),
      historyText.replace(/\s+/g, " ").slice(0, 180),
    );
    check("a finished run has no Stop button", (await page.getByRole("button", { name: "Stop" }).count()) === 0);
    await shot(page, "08-history");

    await page.locator(".routines-nav-item").filter({ hasText: "Once reminder" }).click();
    await page.waitForFunction(() => document.querySelector(".routine-editor h2")?.textContent === "Once reminder");
    check(
      "an unsaved draft survives the History tab",
      (await instruction.inputValue()) === "Unsaved draft survives history.",
    );
    await instruction.fill(originalInstruction);
    await watch();
    const frequency = await page.locator(".schedule-grid select").first().inputValue();
    const dateValue = await page.locator('.routines-modal input[type="date"]').inputValue();
    const timeValue = await page.locator('.routines-modal input[type="time"]').inputValue();
    check("the one-time routine opens on Once", frequency === "once", frequency);
    check("the date comes from the stored run time", dateValue === onceDate, dateValue);
    check("the time comes from the stored run time", timeValue === "16:00", timeValue);
    check(
      "the editor shows the next one-time run",
      /Next run/.test(await page.locator(".field-note").innerText()),
    );
    await shot(page, "03-once-editor");

    await page.locator(".new-routine-button").click();
    const editor = page.locator(".routines-modal");
    check(
      "a new routine does the work",
      (await editor.getByRole("switch", { name: "Only look and report" }).getAttribute("aria-checked")) === "false",
    );
    await editor.getByLabel("Name", { exact: true }).fill("E2E reminder");
    await editor.getByLabel("Instruction").fill("Run the end-to-end checks and report the result.");
    await page.locator(".schedule-grid select").first().selectOption("once");
    const createDate = futureDate(3);
    const createDateText = localDateText(createDate);
    await page.locator('.routines-modal input[type="date"]').fill(createDateText);
    await page.locator('.routines-modal input[type="time"]').fill("16:30");
    await watch();
    await shot(page, "04-new-once");
    await page.getByRole("button", { name: "Create routine" }).click();
    await page.waitForFunction(
      () => [...document.querySelectorAll(".routines-nav-item")].some((item) =>
        item.textContent?.includes("E2E reminder"),
      ),
      null,
      { timeout: 20_000 },
    );
    await watch(1200);

    const list = await page.evaluate((id) => window.fid.routines.list(id), agentId);
    const created = list.find((routine) => routine.name === "E2E reminder");
    check(
      "the UI creates a one-time routine",
      created?.once === true && Boolean(created?.runAt) && created?.readOnly === false,
    );
    const createdDate = created ? new Date(created.runAt) : null;
    check(
      "the stored time matches the editor",
      createdDate !== null &&
        localDateText(createdDate) === createDateText &&
        createdDate.getHours() === 16 &&
        createdDate.getMinutes() === 30,
      created?.runAt ?? "",
    );
    check(
      "the new routine shows its only run",
      /Once ·/.test(await page.locator(".routines-nav-item.is-active").innerText()),
    );
    await shot(page, "05-created");

    await editor.getByLabel("Name", { exact: true }).fill("E2E reminder updated");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForFunction(
      () => {
        const button = [...document.querySelectorAll(".routines-modal button")].find(
          (item) => item.textContent?.trim() === "Save changes",
        );
        const active = document.querySelector(".routines-nav-item.is-active");
        return (
          button instanceof HTMLButtonElement &&
          !button.disabled &&
          Boolean(active?.textContent?.includes("E2E reminder updated"))
        );
      },
      null,
      { timeout: 20_000 },
    );
    check("Save returns the editor to an idle state", true);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("button", { name: "Delete routine" }).click();
    await page.waitForFunction(
      () => ![...document.querySelectorAll(".routines-nav-item")].some((item) =>
        item.textContent?.includes("E2E reminder"),
      ),
      null,
      { timeout: 20_000 },
    );
    await watch();
    const afterDelete = await page.evaluate((id) => window.fid.routines.list(id), agentId);
    check("deleting a one-time routine removes it", !afterDelete.some((routine) => routine.name === "E2E reminder"));

    await page.locator(".routines-nav-item").filter({ hasText: "Weekday sweep" }).click();
    await page.waitForFunction(() => document.querySelector(".routine-editor h2")?.textContent === "Weekday sweep");
    const reportOnly = editor.getByRole("switch", { name: "Only look and report" });
    check("the weekday routine looks and reports", (await reportOnly.getAttribute("aria-checked")) === "true");
    check(
      "the editor explains report-only",
      /Only look and report\. No file changes/.test(await editor.innerText()),
    );
    await reportOnly.click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForFunction(
      () => {
        const button = [...document.querySelectorAll(".routines-modal button")].find(
          (item) => item.textContent?.trim() === "Save changes",
        );
        return button instanceof HTMLButtonElement && !button.disabled;
      },
      null,
      { timeout: 20_000 },
    );
    const savedMode = await page.evaluate((id) => window.fid.routines.list(id), agentId);
    check(
      "the report-only switch saves",
      savedMode.find((routine) => routine.name === "Weekday sweep")?.readOnly === false,
    );

    await page.getByRole("button", { name: "Close routines" }).click();
    await page.waitForSelector(".routines-modal", { state: "detached", timeout: 10_000 });
    const deskAfter = await page.locator(".agent-desk").innerText();
    check("the desk keeps the seeded routines", /Weekday sweep/.test(deskAfter) && /Once reminder/.test(deskAfter));
    await shot(page, "06-after-delete");

    await installBoardStubs();
    const selectedAgent = { id: agentId, name: agentName };
    await page.getByRole("button", { name: /Inbox/ }).click();
    await page.waitForSelector(".inbox-modal", { timeout: 10_000 });
    const inboxText = await page.locator(".inbox-modal").innerText();
    check(
      "the inbox lists the finished routine",
      /Weekday sweep/.test(inboxText) && /Updates/.test(inboxText) && /Build failed/.test(inboxText),
      inboxText.replace(/\s+/g, " ").slice(0, 220),
    );
    await page.locator(".inbox-row").filter({ hasText: "Build failed" }).getByRole("button", { name: "Dismiss" }).click();
    await page.waitForFunction(
      () => !document.querySelector(".inbox-modal")?.textContent?.includes("Build failed"),
      null,
      { timeout: 10_000 },
    );
    check("dismiss removes a stored update", true);

    const askedAt = new Date().toISOString();
    const question = {
      ...request(selectedAgent, "board-question", askedAt),
      question: "Which release should I prepare?",
      choices: ["Patch", "Minor"],
    };
    await sendBoardEvent({ agentId, type: "question-request", question });
    await page.locator(".inbox-modal").getByRole("button", { name: "Minor" }).waitFor({ timeout: 10_000 });
    check(
      "a question is grouped under the agent",
      /Waiting on you/.test(await page.locator(".inbox-modal").innerText()) &&
        /Release desk · 1/.test(await page.locator(".inbox-modal").innerText()),
    );
    await page.locator(".inbox-modal").screenshot({ path: path.join(shots, "needs-you.png") });
    await page.locator(".inbox-modal").getByRole("button", { name: "Minor" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".question-card").length === 0, null, { timeout: 10_000 });
    const asked = await boardState();
    check(
      "answering from the inbox reaches the question",
      asked?.question?.id === "board-question" && asked.question.reply?.kind === "choice" && asked.question.reply.index === 1,
      JSON.stringify(asked?.question),
    );

    const approval = {
      ...request(selectedAgent, "board-approval", new Date().toISOString()),
      turnId: null,
      kind: "shell",
      title: "Run a sensitive command?",
      command: "git push origin main",
      cwd: workspace,
      reason: "This pushes commits to a remote repository.",
    };
    await sendBoardEvent({ agentId, type: "approval-request", approval });
    await page.locator(".inbox-modal").getByRole("button", { name: "Allow once" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".approval-card").length === 0, null, { timeout: 10_000 });
    const allowed = await boardState();
    check(
      "allowing from the inbox reaches the approval",
      allowed?.approval?.id === "board-approval" && allowed.approval.action === "approve",
      JSON.stringify(allowed?.approval),
    );

    const handoff = {
      ...request(selectedAgent, "board-handoff", new Date().toISOString()),
      reason: "Sign in to the ticket site.",
      takenOver: false,
    };
    await sendBoardEvent({ agentId, type: "handoff-request", handoff });
    await page.locator(".inbox-modal").getByRole("button", { name: "Done" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".question-card").length === 0, null, { timeout: 10_000 });
    const handed = await boardState();
    check("done from the inbox reaches the handoff", handed?.handoff === "board-handoff", JSON.stringify(handed?.handoff));

    await page.locator(".inbox-modal").getByRole("button", { name: "Routines", exact: true }).click();
    await page.getByText("Nightly report").waitFor({ timeout: 10_000 });
    const routinesText = await page.locator(".inbox-modal").innerText();
    check(
      "all routines lists every agent",
      /Release desk/.test(routinesText) && /Night desk/.test(routinesText) && /Weekday sweep/.test(routinesText) && /Nightly report/.test(routinesText),
      routinesText.replace(/\s+/g, " ").slice(0, 240),
    );
    await page.locator(".inbox-modal").screenshot({ path: path.join(shots, "all-routines.png") });
    const nightlyRow = page.locator(".inbox-routine").filter({ hasText: "Nightly report" });
    await nightlyRow.getByRole("switch", { name: "Enabled: Nightly report" }).click();
    let enabledNightly = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      enabledNightly = await page.evaluate(
        ([routineId, ownerId]) =>
          window.fid.routines.listAll().then((list) => {
            const routine = list.find((item) => item.id === routineId);
            return routine?.enabled === true && routine.agentId === ownerId;
          }),
        [nightlyId, otherAgentId],
      );
      if (enabledNightly) break;
      await pause(50);
    }
    check("the all-routines switch enables a routine", enabledNightly === true);
    const weekdayRow = page.locator(".inbox-routine").filter({ hasText: "Weekday sweep" });
    await weekdayRow.getByRole("button", { name: "Run now" }).click();
    let ran = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      ran = await boardState();
      if (ran?.run === weekdayId) break;
      await pause(50);
    }
    check("run now from the all-routines list starts that routine", ran?.run === weekdayId, JSON.stringify(ran?.run));
    await nightlyRow.getByRole("button", { name: "Open" }).click();
    await page.waitForSelector(".routines-modal", { timeout: 10_000 });
    const openedAgent = await page.locator(".routines-modal .modal-kicker").innerText();
    check(
      "open switches to that agent's routines",
      openedAgent.trim().toLowerCase() === "night desk",
      openedAgent,
    );
    await page.waitForFunction(
      () => document.querySelector(".routine-editor h2")?.textContent === "Nightly report",
      null,
      { timeout: 10_000 },
    );
    check("the opened dialog shows the nightly routine", true);
    await page.getByRole("button", { name: "Close routines" }).click();
    await page.waitForSelector(".routines-modal", { state: "detached", timeout: 10_000 });

    await ensureAgent(page);
    await page.getByRole("button", { name: /Inbox/ }).click();
    await page.waitForSelector(".inbox-modal", { timeout: 10_000 });
    const settled = {
      ...request(selectedAgent, "chat-approval", new Date().toISOString()),
      turnId: null,
      kind: "shell",
      title: "Run a sensitive command?",
      command: "del notes.tmp",
      cwd: workspace,
      reason: "This deletes files or data.",
    };
    await sendBoardEvent({ agentId, type: "approval-request", approval: settled });
    await page.locator(".inbox-modal").getByText("del notes.tmp").waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Close inbox" }).click();
    await page.waitForSelector(".inbox-modal", { state: "detached", timeout: 10_000 });
    await page.getByRole("button", { name: "Reject" }).click();
    await page.waitForSelector(".approval-card", { state: "detached", timeout: 10_000 });
    await page.getByRole("button", { name: /Inbox/ }).click();
    await page.waitForSelector(".inbox-modal", { timeout: 10_000 });
    const afterChat = await page.locator(".inbox-modal").innerText();
    check("answering in the chat removes the inbox row", !/del notes\.tmp/.test(afterChat), afterChat.replace(/\s+/g, " ").slice(0, 180));
    await shot(page, "09-inbox");
    await page.getByRole("button", { name: "Snooze" }).click();
    await page.waitForFunction(
      () => document.querySelector(".inbox-modal")?.textContent?.includes("Nothing is waiting."),
      null,
      { timeout: 10_000 },
    );
    check("snooze clears the finished routine", true);
    await shot(page, "10-inbox-clear");
    await page.getByRole("button", { name: "Close inbox" }).click();
    await page.waitForSelector(".inbox-modal", { state: "detached", timeout: 10_000 });

    await page.locator(".composer-input").fill("/routine");
    await page.waitForSelector(".command-menu .command-row", { timeout: 10_000 });
    const routineCommand = page.locator(".command-row").filter({ hasText: "/routine" });
    check("the composer offers /routine", (await routineCommand.count()) === 1);
    check(
      "the routine command says it creates a routine",
      /Create a routine/.test(await routineCommand.innerText()),
    );
    await shot(page, "07-routine-command");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".composer-input")?.value === "/routine ");
    check("choosing /routine seeds the composer", true);
    await page.locator(".composer-input").fill("");
    await watch(3000);
  } finally {
    await app?.close().catch(() => undefined);
    if (vite) {
      vite.kill();
      await pause(250);
      vite = null;
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  console.log(`ARTIFACTS: ${root}`);
  if (failed.length > 0) {
    console.log("FAILED:", failed.map((result) => result.name).join("; "));
    process.exitCode = 1;
  } else if (clean) {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
