// Deterministic Electron UI test for the ask_user question card.
//
// Usage:
//   npm run test:questions
//   FID_WATCH_MS=900 npm run test:questions   # pause after each click to watch
//
// No Copilot turn is needed. The test seeds two agents and replaces the
// main-process answer handler, then sends question events to the renderer.
// The runner and tool round trip live in tests/integration/ask-user.test.cjs.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-question-"));
const userData = path.join(root, "userdata");
const shots = path.join(root, "shots");
const agentName = "Question E2E";
const otherAgentName = "Question Banner E2E";
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

function question(agent, id, text, choices) {
  return {
    id,
    agentId: agent.id,
    agentName: agent.name,
    question: text,
    choices,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function seed() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Seeded question card",
    systemPrompt: "Ask before guessing.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly: false,
    memoryEnabled: false,
  });
  const otherAgent = db.createAgent({
    name: otherAgentName,
    description: "Seeded question banner",
    systemPrompt: "Ask before guessing.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly: false,
    memoryEnabled: false,
  });
  db.addMessage(agent.id, "user", "Help me pick a release.");
  db.addMessage(agent.id, "assistant", "Which release should I prepare?");
  db.close();
  return { agent, otherAgent };
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

async function ensureAgent(name) {
  await page.waitForSelector(".agent-row", { timeout: 30_000 });
  const title = await page.locator(".chat-title h1").first().innerText().catch(() => "");
  if (title.trim() === name) return;
  await page.locator(".agent-row").filter({ hasText: name }).first().click();
  await page.waitForFunction(
    (wanted) => document.querySelector(".chat-title h1")?.textContent?.trim() === wanted,
    name,
    { timeout: 15_000 },
  );
}

async function installQuestionStub() {
  await app.evaluate(({ ipcMain }) => {
    const state = { question: null, answer: null };
    globalThis.__fidQuestionE2E = state;
    ipcMain.removeHandler("chat:question");
    ipcMain.handle("chat:question", (_event, questionId, reply) => {
      state.answer = { questionId, reply };
      if (!state.question || state.question.id !== questionId) return false;
      state.question = null;
      return true;
    });
    ipcMain.removeHandler("questions:pending");
    ipcMain.handle("questions:pending", () => (state.question ? [state.question] : []));
  });
}

async function sendQuestionEvent(payload) {
  await app.evaluate(({ BrowserWindow }, next) => {
    const state = globalThis.__fidQuestionE2E;
    state.answer = null;
    state.question = next.question;
    BrowserWindow.getAllWindows()[0]?.webContents.send("chat:event", {
      agentId: next.agentId,
      type: "question-request",
      question: next.question,
    });
  }, payload);
}

async function sendQuestion(payload) {
  await sendQuestionEvent(payload);
  await page.waitForSelector(".question-card", { timeout: 10_000 });
}

async function sendResolved(payload) {
  await app.evaluate(({ BrowserWindow }, next) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("chat:event", {
      agentId: next.agentId,
      type: "question-resolved",
      questionId: next.questionId,
      source: next.source,
    });
  }, payload);
}

async function readAnswer() {
  return app.evaluate(async () => {
    const state = globalThis.__fidQuestionE2E;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (state.answer) return state.answer;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  });
}

async function main() {
  const { agent, otherAgent } = await seed();
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
    await ensureAgent(agentName);
    await installQuestionStub();

    const first = question(agent, "question-choice", "Which release should I prepare?", ["Patch", "Minor"]);
    await sendQuestion({ agentId: agent.id, question: first });
    await watch();
    const cardText = await page.locator(".question-card").innerText();
    check("the card shows the question and both choices", /Which release should I prepare\?/.test(cardText) && /Patch/.test(cardText) && /Minor/.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 160));
    check("the card shows a countdown", /\d:\d{2}/.test(await page.locator(".question-countdown").innerText()));
    await shot("01-question");

    await page.locator(".question-card").getByRole("button", { name: "Minor" }).click();
    await watch();
    const choiceAnswer = await readAnswer();
    check(
      "a choice reaches the main process",
      choiceAnswer?.questionId === first.id && choiceAnswer.reply.kind === "choice" && choiceAnswer.reply.index === 1,
      JSON.stringify(choiceAnswer),
    );
    await page.waitForSelector(".question-card", { state: "detached", timeout: 10_000 });
    check("a choice closes the card", true);
    await watch();

    const second = question(agent, "question-other", "When should this run?", ["Today", "Tomorrow"]);
    await sendQuestion({ agentId: agent.id, question: second });
    await watch();
    const answerButton = page.locator(".question-other").getByRole("button", { name: "Answer" });
    check("the own-answer button starts disabled", await answerButton.isDisabled());
    await page.locator(".question-other-input").fill("Next Monday");
    await watch();
    check("typing enables the own-answer button", await answerButton.isEnabled());
    await answerButton.click();
    await watch();
    const otherAnswer = await readAnswer();
    check(
      "an own answer reaches the main process",
      otherAnswer?.questionId === second.id &&
        otherAnswer.reply.kind === "other" &&
        otherAnswer.reply.text === "Next Monday",
      JSON.stringify(otherAnswer),
    );
    await page.waitForSelector(".question-card", { state: "detached", timeout: 10_000 });
    check("an own answer closes the card", true);
    await shot("02-other");

    const third = question(agent, "question-skip", "Which log should I read?", ["App", "Build"]);
    await sendQuestion({ agentId: agent.id, question: third });
    await watch();
    await page.locator(".question-card-actions").getByRole("button", { name: "Skip" }).click();
    await watch();
    const skipAnswer = await readAnswer();
    check(
      "skip reaches the main process",
      skipAnswer?.questionId === third.id && skipAnswer.reply.kind === "skip",
      JSON.stringify(skipAnswer),
    );
    await page.waitForSelector(".question-card", { state: "detached", timeout: 10_000 });
    check("skip closes the card", true);

    const fourth = question(agent, "question-resolved", "Is this still open?", ["Yes", "No"]);
    await sendQuestion({ agentId: agent.id, question: fourth });
    await sendResolved({ agentId: agent.id, questionId: fourth.id, source: "timeout" });
    await watch();
    await page.waitForSelector(".question-card", { state: "detached", timeout: 10_000 });
    check("a resolved event closes the card", true);

    const banner = question(otherAgent, "question-banner", "Which branch?", ["Main", "Feature"]);
    await sendQuestionEvent({
      agentId: otherAgent.id,
      question: banner,
    });
    await page.waitForSelector(".approval-notice", { timeout: 10_000 });
    const bannerText = await page.locator(".approval-notice").innerText();
    check(
      "another agent's question shows in the top bar",
      /Answer needed for Question Banner E2E/.test(bannerText),
      bannerText.replace(/\s+/g, " ").slice(0, 160),
    );
    await page.locator(".approval-notice").click();
    await watch();
    await page.waitForFunction(
      (wanted) => document.querySelector(".chat-title h1")?.textContent?.trim() === wanted,
      otherAgentName,
      { timeout: 15_000 },
    );
    await page.waitForSelector(".question-card", { timeout: 10_000 });
    check(
      "opening the other agent shows its card",
      /Which branch\?/.test(await page.locator(".question-card").innerText()),
    );
    await shot("03-banner");
    await page.locator(".question-card").getByRole("button", { name: "Feature" }).click();
    await watch();
    const bannerAnswer = await readAnswer();
    check(
      "the other agent's choice reaches the main process",
      bannerAnswer?.questionId === banner.id && bannerAnswer.reply.kind === "choice" && bannerAnswer.reply.index === 1,
      JSON.stringify(bannerAnswer),
    );
    await page.waitForSelector(".question-card", { state: "detached", timeout: 10_000 });
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
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
