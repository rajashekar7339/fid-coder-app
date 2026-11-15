// Deterministic Electron UI test for editing and deleting chat messages.
//
// Usage:
//   npm run test:message-actions
//   FID_WATCH_MS=900 npm run test:message-actions
//
// No Copilot turn is needed. The test seeds chat and routine turns, opens the
// inline editor, cancels it, and deletes one chat turn.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-message-actions-"));
const userData = path.join(root, "userdata");
const shots = path.join(root, "shots");
const watchMs = Number(process.env.FID_WATCH_MS ?? 0);
const agentName = "Message Actions E2E";
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

function addTurn(db, agentId, user, assistant, source = "chat") {
  const turnId = db.createTurn(agentId, source);
  const userMessage = db.addMessage(agentId, "user", user, turnId);
  if (assistant) db.addMessage(agentId, "assistant", assistant, turnId);
  db.finishTurn(turnId, "ok");
  return { turnId, userMessage };
}

function prepare() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Edits a chat",
    systemPrompt: "Reply briefly.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly: true,
    memoryEnabled: false,
  });
  addTurn(db, agent.id, "First question", "First answer");
  addTurn(db, agent.id, "Second question", "Second answer");
  addTurn(db, agent.id, "[Routine] Nightly check", "Routine answer", "routine");
  addTurn(db, agent.id, "Later question", "Later answer");
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

async function paneShot(name) {
  const file = path.join(shots, `${name}.png`);
  const box = await page.locator(".chat-pane").boundingBox();
  await page.screenshot({ path: file, ...(box ? { clip: box } : {}) });
  console.log("  shot:", file);
}

async function ensureAgent() {
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

async function messageTexts(agentId) {
  return page.evaluate(async (id) => {
    const list = await window.fid.messages.list(id);
    return list.map((message) => `${message.role}: ${message.content}`);
  }, agentId);
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
      BrowserWindow.getAllWindows()[0]?.setSize(1360, 940);
    });
    await ensureAgent();
    await page.waitForFunction(() => document.querySelectorAll(".user-message").length === 4, null, {
      timeout: 30_000,
    });
    await watch();

    check("chat messages show actions", (await page.locator(".user-actions").count()) === 3);
    const routine = page.locator(".user-message").filter({ hasText: "[Routine] Nightly check" });
    check("a routine message is read-only", (await routine.locator(".user-actions").count()) === 0);
    await shot("01-user-actions");
    await paneShot("02-user-actions-pane");

    const first = page.locator(".user-message").filter({ hasText: "First question" });
    await watch();
    await first.getByRole("button", { name: "Edit message" }).click();
    const editor = page.locator(".user-edit-input");
    await editor.waitFor({ timeout: 10_000 });
    check("Edit opens the message text", (await editor.inputValue()) === "First question");
    check(
      "the edit note explains the rewind",
      /removes the reply and every later message/i.test(await page.locator(".user-edit-note").innerText()),
    );
    await page.waitForTimeout(250);
    const geometry = await page.evaluate(() => {
      const input = document.querySelector(".user-edit-input");
      const day = document.querySelector(".day-separator");
      const scroll = document.querySelector(".chat-scroll");
      if (!(input instanceof HTMLElement) || !(day instanceof HTMLElement) || !(scroll instanceof HTMLElement)) {
        return null;
      }
      const ir = input.getBoundingClientRect();
      const dr = day.getBoundingClientRect();
      const sr = scroll.getBoundingClientRect();
      return {
        inputTop: Math.round(ir.top),
        inputBottom: Math.round(ir.bottom),
        dayTop: Math.round(dr.top),
        dayBottom: Math.round(dr.bottom),
        scrollTop: scroll.scrollTop,
        scrollHeight: scroll.scrollHeight,
        clientHeight: scroll.clientHeight,
        scrollTopViewport: Math.round(sr.top),
        value: input.value,
        color: getComputedStyle(input).color,
      };
    });
    check(
      "the editor sits below the day header",
      Boolean(geometry) && geometry.inputTop >= geometry.dayBottom,
      geometry ? `input ${geometry.inputTop}, day ${geometry.dayBottom}` : "no geometry",
    );
    await watch();
    await paneShot("03-inline-edit");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".user-edit-input"), null, {
      timeout: 10_000,
    });
    check("Cancel closes the editor", (await first.locator(".user-bubble").innerText()) === "First question");

    const second = page.locator(".user-message").filter({ hasText: "Second question" });
    await watch();
    await second.getByRole("button", { name: "Delete message" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this message?" });
    await dialog.waitFor({ timeout: 10_000 });
    check(
      "the delete dialog says later messages stay",
      /Later messages stay/i.test(await dialog.innerText()),
    );
    await watch();
    await shot("04-delete-confirm");
    await dialog.getByRole("button", { name: "Delete message", exact: true }).click();
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll(".user-message")].some((item) =>
          item.textContent?.includes("Second question"),
        ),
      null,
      { timeout: 15_000 },
    );
    const texts = await messageTexts(agentId);
    check("Delete removes the message and its reply", !texts.some((text) => /Second question|Second answer/.test(text)));
    check(
      "Delete keeps earlier and later turns",
      texts.some((text) => text.includes("First question")) &&
        texts.some((text) => text.includes("Later question")) &&
        texts.some((text) => text.includes("Routine answer")),
    );
    await shot("05-after-delete");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("message actions run completed", false, message.slice(0, 240));
    console.error("MESSAGE ACTIONS E2E FAILED:", error);
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
  console.error("MESSAGE ACTIONS E2E FAILED:", error);
  process.exitCode = 1;
});
