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
const agentName = "Routines E2E";
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

  db.createRoutine(
    {
      agentId: agent.id,
      name: "Weekday sweep",
      prompt: "Check the open tickets.",
      cron: "0 9 * * 1-5",
      once: false,
      runAt: null,
      enabled: true,
      notify: true,
    },
    nextRunIso("0 9 * * 1-5"),
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
  return { agentId: agent.id, onceDate: localDateText(onceDate) };
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

async function main() {
  const { agentId, onceDate } = await seed();
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
    await shot(page, "01-desk");

    await openRoutines(page);
    const navText = await page.locator(".routines-nav-list").innerText();
    check("the dialog lists the repeating routine", /Weekday sweep/.test(navText) && /Weekdays at 9:00/.test(navText));
    check("the dialog lists the one-time routine", /Once reminder/.test(navText) && /Once ·/.test(navText));
    await shot(page, "02-routines-list");

    await page.locator(".routines-nav-item").filter({ hasText: "Once reminder" }).click();
    await page.waitForFunction(() => document.querySelector(".routine-editor h2")?.textContent === "Once reminder");
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
    check("the UI creates a one-time routine", created?.once === true && Boolean(created?.runAt));
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

    await page.getByRole("button", { name: "Close routines" }).click();
    await page.waitForSelector(".routines-modal", { state: "detached", timeout: 10_000 });
    const deskAfter = await page.locator(".agent-desk").innerText();
    check("the desk keeps the seeded routines", /Weekday sweep/.test(deskAfter) && /Once reminder/.test(deskAfter));
    await shot(page, "06-after-delete");

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
