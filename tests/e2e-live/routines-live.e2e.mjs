// Live end-to-end test for scheduling a routine from chat.
//
// Usage:
//   npm run test:routines-live
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// The test launches its own Electron instance with a temporary userData
// directory and workspace. It reuses Vite on port 5173 if one is running;
// otherwise it starts and stops its own. One real Copilot turn is used.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-routines-live-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Routines Live E2E";
const clean = process.env.FID_CLEAN === "1";
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
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "src", "demo.ts"), "export const value = 1;\n", "utf8");
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Creates routines",
    systemPrompt: "Keep replies short. When asked to schedule something, use the routine tools.",
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

async function sendAndWait(page, prompt) {
  await page.waitForFunction(
    () => {
      const input = document.querySelector(".composer-input");
      return input && !input.disabled;
    },
    { timeout: 30_000 },
  );
  await page.locator(".composer-input").fill(prompt);
  await watch(1500);
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(
    () =>
      Boolean(document.querySelector('button[aria-label="Stop generating"]')) ||
      Boolean(document.querySelector(".chat-error")),
    { timeout: 60_000, polling: 300 },
  );
  const early = await page.locator(".chat-error").allInnerTexts();
  if (early.length > 0) throw new Error(`chat error: ${early.join(" ")}`);
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Stop generating"]'),
    { timeout: 240_000, polling: 500 },
  );
  await page.waitForTimeout(1200);
  const late = await page.locator(".chat-error").allInnerTexts();
  if (late.length > 0) throw new Error(`chat error: ${late.join(" ")}`);
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
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 980);
    });
    await ensureAgent(page);
    await watch(1500);

    const status = await page.evaluate(() => window.fid.settings.get({ refreshAuth: true }));
    check("signed in to Copilot", status.signedIn === true, status.authStatus);
    if (!status.signedIn) throw new Error("Copilot is not signed in; cannot run the live turn");

    await sendAndWait(
      page,
      "/routine Create a one-time reminder for tomorrow at 09:00 to run the tests in this workspace. Do not run anything yet.",
    );
    await watch(2500);
    const labels = await page
      .locator(".tool-step-label")
      .evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ""));
    check("the agent used the routine tool", labels.includes("Created a routine"), labels.join(", "));

    const routines = await page.evaluate((id) => window.fid.routines.list(id), agentId);
    const created = routines.find((routine) => /test/i.test(routine.prompt));
    check("the agent created a routine", Boolean(created), JSON.stringify(routines).slice(0, 240));
    check("the routine is one-time", created?.once === true);
    if (created) {
      const runAt = new Date(created.runAt);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      check(
        "the routine runs tomorrow at 09:00",
        runAt.getFullYear() === tomorrow.getFullYear() &&
          runAt.getMonth() === tomorrow.getMonth() &&
          runAt.getDate() === tomorrow.getDate() &&
          runAt.getHours() === 9 &&
          runAt.getMinutes() === 0,
        created.runAt,
      );
    }
    await shot(page, "01-created-from-chat");

    if (!(await page.locator(".agent-desk").count())) {
      await page.locator('button[aria-label="Show agent desk"]').click();
      await page.waitForSelector(".agent-desk", { timeout: 10_000 });
    }
    const deskText = await page.locator(".agent-desk").innerText();
    check("the created routine appears in the desk", /Once ·/.test(deskText), deskText.replace(/\s+/g, " ").slice(0, 160));
    await shot(page, "02-desk");
    await watch(4000);
  } finally {
    if (app) await app.close().catch(() => undefined);
    if (vite) vite.kill();
    const failed = results.filter((item) => !item.ok);
    console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
    console.log("ARTIFACTS:", root);
    if (failed.length > 0) {
      console.log("FAILED:", failed.map((item) => item.name).join("; "));
      process.exitCode = 1;
    } else if (clean) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error("ROUTINES LIVE E2E FAILED:", error);
  process.exitCode = 1;
});
