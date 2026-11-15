// Live end-to-end test for the ask_user card.
//
// Usage:
//   npm run test:questions-live
//   FID_E2E_SLOW_MS=1500 npm run test:questions-live   # pause before actions
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// The test launches its own Electron instance with a temporary userData
// directory and workspace. One real Copilot turn asks a question; the test
// answers the card and checks that the turn continues with that answer.
// It uses Ask mode so the turn cannot change the workspace.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-question-live-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Question Live E2E";
const slowMs = Number(process.env.FID_E2E_SLOW_MS || 0);
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");

const results = [];
let vite = null;
let app = null;

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
  fs.writeFileSync(path.join(workspace, "demo.txt"), "A small live-test workspace.\n", "utf8");
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Asks one question",
    systemPrompt:
      "You are a live test agent. When the user asks you to prepare a release, you must call ask_user exactly once before any other reply. Use the question 'Which release should I prepare?' and exactly these two choices: 'Patch' and 'Minor'. Do not answer with text first. After the tool returns, reply with one short sentence that includes the chosen answer. Use no other tools.",
    workspaceDir: workspace,
    model: "auto",
    toolProfile: "developer",
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

async function composerReady(page) {
  await page.waitForFunction(
    () => {
      const input = document.querySelector(".composer-input");
      return input && !input.disabled;
    },
    null,
    { timeout: 30_000 },
  );
}

async function startTurn(page, prompt) {
  await composerReady(page);
  await page.locator(".composer-input").fill(prompt);
  await watch(1500);
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(
    () => Boolean(document.querySelector('button[aria-label="Stop generating"]')),
    null,
    { timeout: 60_000, polling: 200 },
  );
}

async function waitForQuestionOrEnd(page) {
  try {
    await page.waitForFunction(
      () =>
        Boolean(document.querySelector(".question-card")) ||
        Boolean(document.querySelector(".chat-error")) ||
        !document.querySelector('button[aria-label="Stop generating"]'),
      null,
      { timeout: 180_000, polling: 300 },
    );
  } catch (error) {
    const errors = await page.locator(".chat-error").allInnerTexts();
    const last = await lastAssistantText(page);
    throw new Error(
      `no question card. errors=${errors.join(" ")} last=${last.replace(/\s+/g, " ").slice(0, 240)}`,
    );
  }
  const errors = await page.locator(".chat-error").allInnerTexts();
  if (errors.length > 0) throw new Error(`chat error: ${errors.join(" ")}`);
  return (await page.locator(".question-card").count()) > 0;
}

async function answerFirstChoice(page) {
  const choices = await page.locator(".question-card .question-choice").allInnerTexts();
  if (choices.length < 2) throw new Error(`the card has ${choices.length} choices`);
  const chosen = choices[0].trim();
  await watch(1500);
  await page.locator(".question-card .question-choice").first().click();
  await page.waitForSelector(".question-card", { state: "detached", timeout: 10_000 });
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Stop generating"]'),
    null,
    { timeout: 240_000, polling: 500 },
  );
  await page.waitForTimeout(1500);
  const errors = await page.locator(".chat-error").allInnerTexts();
  if (errors.length > 0) throw new Error(`chat error: ${errors.join(" ")}`);
  return chosen;
}

async function lastAssistantText(page) {
  const bodies = page.locator("article.message .message-body");
  const count = await bodies.count();
  return count === 0 ? "" : bodies.nth(count - 1).innerText();
}

async function toolMessages(page, agentId) {
  return page.evaluate(async (id) => {
    const messages = await window.fid.messages.list(id);
    return messages.filter((message) => message.role === "tool").map((message) => message.content);
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
    const page = await app.firstWindow({ timeout: 60_000 });
    page.on("pageerror", (error) => console.log("[pageerror]", error.message));
    await page.waitForSelector(".app-shell", { timeout: 60_000 });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1400, 950);
    });
    await ensureAgent(page);
    await watch(1500);

    const status = await page.evaluate(() => window.fid.settings.get({ refreshAuth: true }));
    check("signed in to Copilot", status.signedIn === true, status.authStatus);
    if (!status.signedIn) throw new Error("Copilot is not signed in; cannot run the live turn");

    await startTurn(
      page,
      "Use ask_user now to ask me which release to prepare. Offer exactly Patch and Minor. Wait for my answer, then tell me which release I chose.",
    );
    const sawCard = await waitForQuestionOrEnd(page);
    check("the live agent called ask_user", sawCard);
    if (!sawCard) {
      const last = await lastAssistantText(page);
      throw new Error(`the turn ended without a question card: ${last.slice(0, 240)}`);
    }

    const cardText = await page.locator(".question-card").innerText();
    check(
      "the card shows the question and choices",
      /Which release should I prepare\?/i.test(cardText) && /Patch/.test(cardText) && /Minor/.test(cardText),
      cardText.replace(/\s+/g, " ").slice(0, 200),
    );
    await shot(page, "01-question");

    const chosen = await answerFirstChoice(page);
    await watch(2000);
    check("the question card closed after the answer", true);

    const reply = await lastAssistantText(page);
    check(
      "the live agent continued after the answer",
      Boolean(reply.trim()),
      reply.replace(/\s+/g, " ").slice(0, 200),
    );
    check(
      "the final reply includes the chosen answer",
      reply.toLowerCase().includes(chosen.toLowerCase()),
      `${chosen} -> ${reply.replace(/\s+/g, " ").slice(0, 200)}`,
    );

    const tools = await toolMessages(page, agentId);
    const asked = tools.filter((text) => text.includes("ask_user"));
    check("the transcript records the ask_user result", asked.length > 0, asked.join(" | ").slice(0, 240));
    check(
      "the recorded result carries the answer",
      asked.some((text) => text.toLowerCase().includes(chosen.toLowerCase())),
      asked.join(" | ").slice(0, 240),
    );
    await shot(page, "02-answered");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("live run completed", false, message.slice(0, 240));
    console.error("QUESTION LIVE E2E FAILED:", error);
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
  console.error(error);
  process.exitCode = 1;
});
