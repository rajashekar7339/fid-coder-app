// Live end-to-end test for queue-while-running and Send now.
//
// Usage:
//   npm run test:queue-live
//   FID_E2E_SLOW_MS=1500 npm run test:queue-live
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// The agent holds each setup turn on ask_user. That gives the test a stable
// running turn while it queues a follow-up. Stage 1 answers the question and
// lets the queued message run. Stage 2 force-sends a draft with Ctrl+Enter,
// which closes the question card and keeps the other queued message.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-queue-live-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Queue Live E2E";
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
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, "release.txt"), "Release notes live here.\n", "utf8");
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Holds a turn on a question",
    systemPrompt:
      "You are a live test agent. Every time the user says 'Prepare a release', call ask_user exactly once before any other reply, even if you asked earlier. Use the question 'Which release?' and exactly two choices: 'Patch' and 'Minor'. Do not answer with text first. After the tool returns, reply with one short sentence. When the user asks for a token reply, reply with exactly that token and nothing else. Use no other tools.",
    workspaceDir: workspace,
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

async function startQuestionTurn() {
  await composerReady();
  await page.locator(".composer-input").fill("Prepare a release.");
  await watch();
  await page.locator(".composer-input").press("Enter");
  await page.waitForSelector(".question-card", { timeout: 180_000 });
  await page.waitForFunction(
    () => Boolean(document.querySelector('button[aria-label="Stop generating"]')),
    null,
    { timeout: 60_000, polling: 200 },
  );
}

async function queueDraft(token) {
  await page.locator(".composer-input").fill(`Reply with exactly ${token}.`);
  await watch();
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll(".queue-row-text")].some(
        (row) => row.textContent?.trim() === `Reply with exactly ${text}.`,
      ),
    token,
    { timeout: 15_000 },
  );
}

async function answerQuestion() {
  await page.locator(".question-card .question-choice").first().click();
  await page.waitForSelector(".question-card", { state: "detached", timeout: 15_000 });
  await watch();
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

async function waitForIdle() {
  await page.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="Stop generating"]') &&
      !document.querySelector(".queue-panel"),
    null,
    { timeout: 240_000, polling: 500 },
  );
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

    await startQuestionTurn();
    check("the composer stays enabled while a turn runs", !(await page.locator(".composer-input").isDisabled()));
    await queueDraft("QUEUED-OK");
    check("Enter adds the message to the queue", (await page.locator(".queue-row").count()) === 1);
    check(
      "the running turn is still marked by Stop",
      (await page.locator('button[aria-label="Stop generating"]').count()) === 1,
    );
    await shot("01-queued-while-running");

    await answerQuestion();
    await waitForAssistant(agentId, "QUEUED-OK");
    await waitForIdle();
    const afterQueue = await messages(agentId);
    check(
      "the queued message became a normal user turn",
      afterQueue.some(
        (message) =>
          message.role === "user" && message.content.trim() === "Reply with exactly QUEUED-OK.",
      ),
    );
    check("the queue drains after the turn", (await page.locator(".queue-panel").count()) === 0);

    await startQuestionTurn();
    await queueDraft("STAY-QUEUED");
    await page.locator(".composer-input").fill("Reply with exactly FORCED-OK.");
    await watch();
    await shot("02-ready-to-send-now");
    await page.locator(".composer-input").press("Control+Enter");
    await page.waitForSelector(".question-card", { state: "detached", timeout: 15_000 });
    check(
      "the queued message stays after Send now",
      (await page.locator(".queue-row-text").allInnerTexts()).join(" ") ===
        "Reply with exactly STAY-QUEUED.",
    );
    await waitForAssistant(agentId, "FORCED-OK");
    await watch();
    await shot("03-forced-send");
    const forceErrors = await chatErrors();
    check("Send now does not show a stop error", forceErrors.length === 0, forceErrors.join(" | "));

    await waitForAssistant(agentId, "STAY-QUEUED");
    await waitForIdle();
    const afterForce = await messages(agentId);
    const userTexts = afterForce.filter((message) => message.role === "user").map((message) => message.content.trim());
    check(
      "the forced message is a normal user turn",
      userTexts.includes("Reply with exactly FORCED-OK."),
    );
    check(
      "the remaining queued message runs after the forced turn",
      userTexts.includes("Reply with exactly STAY-QUEUED."),
      userTexts.join(" | "),
    );
    check("no chat errors after both paths", (await chatErrors()).length === 0, (await chatErrors()).join(" | "));
    await shot("04-drained");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("live queue run completed", false, message.slice(0, 240));
    console.error("QUEUE LIVE E2E FAILED:", error);
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
  console.error("QUEUE LIVE E2E FAILED:", error);
  process.exitCode = 1;
});
