// Live end-to-end test for /skill-save over a multi-turn task.
//
// Usage:
//   npm run test:skill-command-live
//   FID_E2E_SLOW_MS=1500 npm run test:skill-command-live
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// Two setup turns describe a procedure. Then /skill-save must draft a skill
// that covers both steps, not only the last exchange. The test saves it and
// checks the written SKILL.md.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-skill-command-live-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Skill Command Live E2E";
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
  fs.writeFileSync(
    path.join(workspace, "release-checklist.md"),
    "Checklist: verify the release branch.\n",
    "utf8",
  );
  fs.writeFileSync(path.join(workspace, "release-tests.md"), "Tests: run the release checks.\n", "utf8");
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Builds a skill from a whole task",
    systemPrompt:
      "You are a live test agent. Follow the user's instructions. Keep replies short. Never call save_skill until the user sends the exact command /skill-save.",
    workspaceDir: workspace,
    model: "auto",
    toolProfile: "developer",
    readOnly: false,
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
  await watch();
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(
    () => Boolean(document.querySelector('button[aria-label="Stop generating"]')),
    null,
    { timeout: 60_000, polling: 200 },
  );
}

async function startCommand(page, command) {
  await composerReady(page);
  await page.locator(".composer-input").fill(command);
  await page.waitForSelector(".command-menu", { timeout: 10_000 });
  await page.locator(".command-menu").getByRole("option", { name: /Save this as a skill/ }).click();
  await page.waitForFunction(
    (value) => document.querySelector(".composer-input")?.value.trim() === value,
    command,
    { timeout: 10_000 },
  );
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(
    () => Boolean(document.querySelector('button[aria-label="Stop generating"]')),
    null,
    { timeout: 60_000, polling: 200 },
  );
}

async function finishTurn(page) {
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Stop generating"]'),
    null,
    { timeout: 240_000, polling: 500 },
  );
  await page.waitForTimeout(1200);
  const errors = await page.locator(".chat-error").allInnerTexts();
  if (errors.length > 0) throw new Error(`chat error: ${errors.join(" ")}`);
}

async function lastAssistantText(page) {
  const bodies = page.locator("article.message .message-body");
  const count = await bodies.count();
  return count === 0 ? "" : bodies.nth(count - 1).innerText();
}

async function waitForSkillCard(page) {
  try {
    await page.waitForFunction(
      () =>
        Boolean(document.querySelector('[aria-label="Save skill"]')) ||
        Boolean(document.querySelector(".chat-error")) ||
        !document.querySelector('button[aria-label="Stop generating"]'),
      null,
      { timeout: 240_000, polling: 300 },
    );
  } catch (error) {
    const errors = await page.locator(".chat-error").allInnerTexts();
    const last = await lastAssistantText(page);
    throw new Error(
      `no skill card. errors=${errors.join(" ")} last=${last.replace(/\s+/g, " ").slice(0, 240)}`,
    );
  }
  const errors = await page.locator(".chat-error").allInnerTexts();
  if (errors.length > 0) throw new Error(`chat error: ${errors.join(" ")}`);
  return (await page.locator('[aria-label="Save skill"]').count()) > 0;
}

async function toolMessages(page, agentId) {
  return page.evaluate(async (id) => {
    const messages = await window.fid.messages.list(id);
    return messages.filter((message) => message.role === "tool").map((message) => message.content);
  }, agentId);
}

function savedSkillContains(tokens) {
  const dir = path.join(userData, "skills");
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    if (tokens.every((token) => text.toLowerCase().includes(token.toLowerCase()))) return { file, text };
  }
  return null;
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
    await watch();

    const status = await page.evaluate(() => window.fid.settings.get({ refreshAuth: true }));
    check("signed in to Copilot", status.signedIn === true, status.authStatus);
    if (!status.signedIn) throw new Error("Copilot is not signed in; cannot run the live turns");

    await startTurn(
      page,
      "Read the file release-checklist.md and reply with its first line only.",
    );
    await finishTurn(page);
    check("no skill card before the command", (await page.locator('[aria-label="Save skill"]').count()) === 0);

    await startTurn(
      page,
      "Read the file release-tests.md and reply with its first line only.",
    );
    await finishTurn(page);
    check("no skill card before the command", (await page.locator('[aria-label="Save skill"]').count()) === 0);
    await shot(page, "01-task");

    await startCommand(page, "/skill-save");
    const sawCard = await waitForSkillCard(page);
    check("the /skill-save command proposed a skill", sawCard);
    if (!sawCard) {
      const last = await lastAssistantText(page);
      throw new Error(`the turn ended without a skill card: ${last.slice(0, 240)}`);
    }

    const card = page.locator('[aria-label="Save skill"]');
    const steps = await card.getByLabel("Skill steps").inputValue();
    check(
      "the draft covers both steps in the task",
      /release-checklist\.md/i.test(steps) && /release-tests\.md/i.test(steps),
      steps.replace(/\s+/g, " ").slice(0, 300),
    );
    await watch(2000);
    await shot(page, "02-draft");

    await card.getByRole("button", { name: "Save", exact: true }).click();
    await card.waitFor({ state: "detached", timeout: 10_000 });
    await finishTurn(page);
    await watch();

    const saved = savedSkillContains(["release-checklist.md", "release-tests.md"]);
    check("the saved SKILL.md covers the whole task", Boolean(saved), saved?.file ?? "no matching file");
    if (saved) {
      check(
        "the saved file keeps the order",
        saved.text.toLowerCase().indexOf("release-checklist.md") <
          saved.text.toLowerCase().indexOf("release-tests.md"),
      );
    }

    const tools = await toolMessages(page, agentId);
    check(
      "the transcript records save_skill",
      tools.some((text) => text.includes("save_skill")),
      tools.join(" | ").slice(0, 300),
    );
    await shot(page, "03-saved");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("live run completed", false, message.slice(0, 240));
    console.error("SKILL COMMAND LIVE E2E FAILED:", error);
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
  console.error("SKILL COMMAND LIVE E2E FAILED:", error);
  process.exitCode = 1;
});
