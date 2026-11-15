// Deterministic Electron UI test for the queued-message panel.
//
// Usage:
//   npm run test:queue
//   FID_WATCH_MS=900 npm run test:queue
//
// No Copilot turn is needed. A composer-only command is queued so the runner
// leaves it in place; the test then drives remove, Send next, and Clear.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-queue-panel-"));
const userData = path.join(root, "userdata");
const shots = path.join(root, "shots");
const watchMs = Number(process.env.FID_WATCH_MS ?? 0);
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");

const results = [];
let vite = null;
let app = null;
let page = null;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function pause(ms = 8) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function watch(ms = watchMs) {
  if (watchMs > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

function prepare() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  for (const agent of db.listAgents()) db.deleteAgent(agent.id);
  const agent = db.createAgent({
    name: "Queue Panel E2E",
    description: "Queues messages",
    systemPrompt: "Reply briefly.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly: true,
    memoryEnabled: false,
  });
  db.close();
  return agent.id;
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

async function shot(name) {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("  shot:", file);
}

async function enqueue(agentId, text) {
  await page.evaluate(
    async ({ id, value }) => {
      await window.fid.chat.enqueue(id, value);
    },
    { id: agentId, value: text },
  );
  await page.waitForSelector(".queue-panel", { timeout: 10_000 });
}

async function queueTexts() {
  return page.locator(".queue-row-text").allInnerTexts();
}

async function main() {
  const agentId = prepare();
  await ensureVite();
  try {
    app = await electron.launch({
      executablePath: path.join(appDir, "node_modules", "electron", "dist", "electron.exe"),
      args: ["."],
      cwd: appDir,
      env: { ...process.env, FID_CODER_USER_DATA: userData },
      timeout: 60_000,
    });
    page = await app.firstWindow({ timeout: 60_000 });
    page.on("pageerror", (error) => console.log("[pageerror]", error.message));
    await page.waitForSelector(".app-shell", { timeout: 60_000 });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1280, 900);
    });
    await page.waitForSelector(".agent-row", { timeout: 30_000 });
    await page.waitForFunction(
      () => document.querySelector(".chat-title h1")?.textContent?.trim() === "Queue Panel E2E",
      null,
      { timeout: 15_000 },
    );
    await watch();

    await enqueue(agentId, "/help");
    check("the queued row is visible", (await queueTexts()).join(" ") === "/help");
    const head = await page.locator(".queue-head").innerText();
    check("the header shows one queued message", /Queued · 1/i.test(head), head.replace(/\s+/g, " "));
    await page.waitForSelector(".queue-paused", { timeout: 10_000 });
    check("a failed start leaves the queue paused", (await page.locator(".queue-paused").count()) === 1);
    const actions = await page.locator(".queue-row-text-button").allInnerTexts();
    check(
      "the row shows Send now, Edit, and Cancel",
      actions.join(" ") === "Send now Edit Cancel",
      actions.join(" | "),
    );
    await shot("01-paused-queue");

    await page.locator('.queue-row-text-button[aria-label^="Edit queued message"]').click();
    const editor = page.locator(".queue-edit-input");
    await editor.waitFor({ timeout: 10_000 });
    check("Edit loads the queued text", (await editor.inputValue()) === "/help");
    await editor.fill("Edited queued message.");
    await editor.press("Enter");
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".queue-row-text")].some(
          (row) => row.textContent?.trim() === "Edited queued message.",
        ),
      null,
      { timeout: 10_000 },
    );
    check("Save updates the queued row", (await queueTexts()).join(" ") === "Edited queued message.");
    await watch();

    await page.locator('.queue-row-text-button[aria-label^="Cancel queued message"]').click();
    await page.waitForFunction(
      () => !document.querySelector(".queue-panel"),
      null,
      { timeout: 10_000 },
    );
    check("Cancel removes the row", (await page.locator(".queue-panel").count()) === 0);

    await enqueue(agentId, "/help");
    await enqueue(agentId, "/files");
    check("two queued rows", (await page.locator(".queue-row").count()) === 2, (await queueTexts()).join(" | "));
    await page.waitForSelector(".queue-paused", { timeout: 10_000 });
    await page.getByRole("button", { name: "Send next" }).click();
    await page.waitForTimeout(800);
    check("Send next keeps the message when the start fails", (await page.locator(".queue-row").count()) === 2);
    await watch();

    await page.getByRole("button", { name: "Clear", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Clear queued messages?" });
    await dialog.waitFor({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Clear queue", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector(".queue-panel"),
      null,
      { timeout: 10_000 },
    );
    check("Clear empties the queue", (await page.locator(".queue-panel").count()) === 0);
    await shot("02-cleared");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("queue panel run completed", false, message.slice(0, 240));
    console.error("QUEUE PANEL E2E FAILED:", error);
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => undefined);
    if (vite) vite.kill();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  console.log(`ARTIFACTS: ${root}`);
  if (failed.length > 0) {
    console.log(`FAILED: ${failed.map((item) => item.name).join("; ")}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("QUEUE PANEL E2E FAILED:", error);
  process.exitCode = 1;
});
