// Deterministic Electron UI test for the tool activity summary and turn duration.
//
// Usage:
//   npm run test:tool-activity
//   FID_WATCH_MS=900 npm run test:tool-activity
//
// No Copilot turn is needed. The test seeds one turn with tool messages and a
// finished assistant reply, then reads the transcript.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-tool-activity-"));
const userData = path.join(root, "userdata");
const shots = path.join(root, "shots");
const watchMs = Number(process.env.FID_WATCH_MS ?? 0);
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");
const { DatabaseSync } = require("node:sqlite");

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

function seed() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  const file = path.join(userData, "fid-coder.sqlite");
  const db = new AppDatabase(file);
  for (const agent of db.listAgents()) db.deleteAgent(agent.id);
  const agent = db.createAgent({
    name: "Tool Activity E2E",
    description: "Reads the transcript",
    systemPrompt: "Reply briefly.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly: true,
    memoryEnabled: false,
  });
  const turn = db.createTurn(agent.id, "chat");
  const user = db.addMessage(agent.id, "user", "Check the project.", turn);
  const first = db.addMessage(agent.id, "tool", "file_read: export const a = 1;", turn);
  const second = db.addMessage(agent.id, "tool", "file_read: export const b = 2;", turn);
  const search = db.addMessage(agent.id, "tool", "search_text: src/a.ts:1", turn);
  const failed = db.addMessage(agent.id, "tool", "shell_run: failed: exit code 1", turn);
  const assistant = db.addMessage(agent.id, "assistant", "I checked the project.", turn);
  db.finishTurn(turn, "success");
  db.close();

  const raw = new DatabaseSync(file);
  raw.prepare("UPDATE turns SET started_at = ?, ended_at = ? WHERE id = ?").run(
    "2026-11-20T10:00:00.000Z",
    "2026-11-20T10:02:05.000Z",
    turn,
  );
  const stamps = [
    [user.id, "2026-11-20T10:00:01.000Z"],
    [first.id, "2026-11-20T10:00:10.000Z"],
    [second.id, "2026-11-20T10:00:20.000Z"],
    [search.id, "2026-11-20T10:00:30.000Z"],
    [failed.id, "2026-11-20T10:00:40.000Z"],
    [assistant.id, "2026-11-20T10:02:00.000Z"],
  ];
  for (const [id, createdAt] of stamps) {
    raw.prepare("UPDATE messages SET created_at = ? WHERE id = ?").run(createdAt, id);
  }
  raw.prepare("UPDATE agents SET updated_at = ? WHERE id = ?").run(
    "2026-11-20T10:02:00.000Z",
    agent.id,
  );
  raw.close();
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

async function main() {
  seed();
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
    await page.waitForSelector(".tool-card", { timeout: 30_000 });

    check(
      "the group counts its steps",
      (await page.locator(".tool-card > summary b").innerText()) === "4 tool steps",
    );
    check(
      "the summary names what the tools did",
      (await page.locator(".tool-summary").innerText()) ===
        "Read 2 files · Searched the code · Ran 1 command",
      await page.locator(".tool-summary").innerText(),
    );
    check(
      "a failed step is counted",
      (await page.locator(".tool-issues").innerText()) === "1 issue",
    );
    await page.locator(".tool-card > summary").click();
    await page.locator(".tool-step").first().waitFor();
    check(
      "a failed step says Failed",
      (await page.locator(".tool-step.is-failed .tool-step-state").innerText()) === "Failed",
      await page.locator(".tool-step.is-failed .tool-step-state").innerText(),
    );
    check(
      "the assistant reply says how long the turn worked",
      (await page.locator(".message-duration").innerText()) === "Worked for 2m",
      await page.locator(".message-duration").innerText(),
    );
    await watch();
    await shot("01-tool-activity");
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
