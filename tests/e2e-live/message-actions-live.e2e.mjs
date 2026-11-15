// Live end-to-end test for editing and deleting chat messages.
//
// Usage:
//   npm run test:message-actions-live
//   FID_E2E_SLOW_MS=1200 npm run test:message-actions-live
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// Sends two real turns, edits the first one, and verifies the second turn was
// rewound and the edited answer replaced it. Then deletes the edited turn.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-message-actions-live-"));
const userData = path.join(root, "userdata");
const shots = path.join(root, "shots");
const agentName = "Message Actions Live";
const slowMs = Number(process.env.FID_E2E_SLOW_MS || 0);
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

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function watch(ms = slowMs) {
  if (ms > 0) await sleep(ms);
}

function prepare() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Edits a live chat",
    systemPrompt:
      "You are a live test agent. Reply with exactly the token the user asks for and nothing else. Do not use tools.",
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
    await sleep(250);
  }
  console.log(log.slice(-3000));
  throw new Error("Vite did not start on 5173");
}

async function shot(name) {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
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

async function composerReady() {
  await page.waitForFunction(
    () => {
      const input = document.querySelector(".composer-input");
      return input && !input.disabled;
    },
    null,
    { timeout: 30_000 },
  );
}

async function messages(agentId) {
  return page.evaluate((id) => window.fid.messages.list(id), agentId);
}

async function waitForAssistant(agentId, token, timeout = 240_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const list = await messages(agentId);
    if (list.some((message) => message.role === "assistant" && message.content.includes(token))) {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`the assistant did not answer ${token}`);
}

async function sendTurn(prompt) {
  await composerReady();
  await page.locator(".composer-input").fill(prompt);
  await watch();
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(
    () => Boolean(document.querySelector('button[aria-label="Stop generating"]')),
    null,
    { timeout: 60_000, polling: 200 },
  );
}

async function finishTurn() {
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Stop generating"]'),
    null,
    { timeout: 240_000, polling: 500 },
  );
  await page.waitForTimeout(1000);
  const errors = await page.locator(".chat-error").allInnerTexts();
  if (errors.length > 0) throw new Error(`chat error: ${errors.join(" ")}`);
}

async function chatErrors() {
  return page.locator(".chat-error").allInnerTexts();
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
      BrowserWindow.getAllWindows()[0]?.setSize(1400, 950);
    });
    await ensureAgent();
    await watch();

    const status = await page.evaluate(() => window.fid.settings.get({ refreshAuth: true }));
    check("signed in to Copilot", status.signedIn === true, status.authStatus);
    if (!status.signedIn) throw new Error("Copilot is not signed in; cannot run the live turns");

    await sendTurn("Reply with exactly FIRST-OK.");
    await finishTurn();
    await waitForAssistant(agentId, "FIRST-OK");
    await watch();
    await sendTurn("Reply with exactly SECOND-OK.");
    await page.waitForFunction(
      () => Boolean(document.querySelector('button[aria-label="Stop generating"]')),
      null,
      { timeout: 60_000, polling: 200 },
    );
    const firstMessage = page.locator(".user-message").filter({ hasText: "Reply with exactly FIRST-OK." }).first();
    check(
      "actions are disabled while the agent runs",
      await firstMessage.getByRole("button", { name: "Edit message" }).isDisabled(),
    );
    await finishTurn();
    await waitForAssistant(agentId, "SECOND-OK");
    await shot("01-two-turns");

    const firstUser = page.locator(".user-message").filter({ hasText: "Reply with exactly FIRST-OK." }).first();
    await watch();
    await firstUser.getByRole("button", { name: "Edit message" }).click();
    const editor = page.locator(".user-edit-input");
    await editor.waitFor({ timeout: 10_000 });
    await editor.fill("Reply with exactly EDITED-OK.");
    await watch();
    await shot("02-edit-open");
    await page.getByRole("button", { name: "Save & rerun" }).click();
    await waitForAssistant(agentId, "EDITED-OK");
    await finishTurn();
    await watch();

    const afterEdit = await messages(agentId);
    const userTexts = afterEdit.filter((message) => message.role === "user").map((message) => message.content.trim());
    check(
      "the edited message is the only user turn",
      userTexts.length === 1 && userTexts[0] === "Reply with exactly EDITED-OK.",
      userTexts.join(" | "),
    );
    check(
      "the old answer and the later turn are gone",
      !afterEdit.some((message) => /FIRST-OK|SECOND-OK/.test(message.content)),
    );
    check(
      "the edited answer replaced them",
      afterEdit.some((message) => message.role === "assistant" && message.content.includes("EDITED-OK")),
    );
    check("editing shows no chat error", (await chatErrors()).length === 0, (await chatErrors()).join(" | "));
    await shot("03-edited");

    const editedUser = page.locator(".user-message").filter({ hasText: "Reply with exactly EDITED-OK." }).first();
    await watch();
    await editedUser.getByRole("button", { name: "Delete message" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this message?" });
    await dialog.waitFor({ timeout: 10_000 });
    await watch();
    await shot("04-delete-confirm");
    await dialog.getByRole("button", { name: "Delete message", exact: true }).click();
    await page.waitForFunction(
      () => ![...document.querySelectorAll(".user-message")].some((item) =>
        item.textContent?.includes("EDITED-OK"),
      ),
      null,
      { timeout: 15_000 },
    );
    await page.waitForFunction(
      () => Boolean(document.querySelector(".chat-empty")),
      null,
      { timeout: 15_000 },
    );
    const afterDelete = await messages(agentId);
    check("Delete removes the edited turn", afterDelete.length === 0, afterDelete.map((message) => message.content).join(" | "));
    check("deleting shows no chat error", (await chatErrors()).length === 0, (await chatErrors()).join(" | "));
    await shot("05-empty");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("live message actions run completed", false, message.slice(0, 240));
    console.error("MESSAGE ACTIONS LIVE E2E FAILED:", error);
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
  console.error("MESSAGE ACTIONS LIVE E2E FAILED:", error);
  process.exitCode = 1;
});
