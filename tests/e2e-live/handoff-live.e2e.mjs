// Live end-to-end test for the browser handoff card.
//
// Usage:
//   npm run test:handoff-live
//   FID_E2E_SLOW_MS=1500 npm run test:handoff-live   # pause before actions
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//   - A local page the agent can navigate to; this test starts its own server.
//
// One real Copilot turn must navigate, call browser_needs_you, wait for Done,
// take a fresh snapshot, and report the page title.

import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-handoff-live-"));
const userData = path.join(root, "userdata");
const shots = path.join(root, "shots");
const agentName = "Handoff Live E2E";
const pageTitle = "Handoff Live Page";
const slowMs = Number(process.env.FID_E2E_SLOW_MS || 0);
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");

const results = [];
let vite = null;
let app = null;
let server = null;
let requests = 0;

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

async function startServer() {
  server = http.createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      `<!doctype html><html><head><title>${pageTitle}</title></head>` +
        "<body><h1>Sign in</h1><p>This is a local handoff test page.</p><button>Sign in</button></body></html>",
    );
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The test server did not start");
  return `http://127.0.0.1:${address.port}/signin`;
}

function prepare(url) {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Hands the browser back",
    systemPrompt: `You are a live test agent. When the user asks you to test the browser handoff, follow these steps exactly:
1. Call browser_navigate with url ${url}.
2. Call browser_needs_you with reason "Sign in to the test page". Do not use another browser tool before this.
3. Wait for the tool to return. After it returns, call browser_snapshot.
4. Reply with one short sentence that includes the page title from the snapshot.
Use no other tools.`,
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
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
  await watch(1500);
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(
    () => Boolean(document.querySelector('button[aria-label="Stop generating"]')),
    null,
    { timeout: 60_000, polling: 200 },
  );
}

async function lastAssistantText(page) {
  const bodies = page.locator("article.message .message-body");
  const count = await bodies.count();
  return count === 0 ? "" : bodies.nth(count - 1).innerText();
}

async function waitForHandoff(page) {
  try {
    await page.waitForFunction(
      () =>
        Boolean(document.querySelector('[aria-label="Needs you"]')) ||
        Boolean(document.querySelector(".chat-error")) ||
        !document.querySelector('button[aria-label="Stop generating"]'),
      null,
      { timeout: 240_000, polling: 300 },
    );
  } catch (error) {
    const errors = await page.locator(".chat-error").allInnerTexts();
    const last = await lastAssistantText(page);
    throw new Error(
      `no handoff card. errors=${errors.join(" ")} last=${last.replace(/\s+/g, " ").slice(0, 240)}`,
    );
  }
  const errors = await page.locator(".chat-error").allInnerTexts();
  if (errors.length > 0) throw new Error(`chat error: ${errors.join(" ")}`);
  return (await page.locator('[aria-label="Needs you"]').count()) > 0;
}

async function finishTurn(page) {
  await page.waitForFunction(
    () => !document.querySelector('button[aria-label="Stop generating"]'),
    null,
    { timeout: 240_000, polling: 500 },
  );
  await page.waitForTimeout(1500);
  const errors = await page.locator(".chat-error").allInnerTexts();
  if (errors.length > 0) throw new Error(`chat error: ${errors.join(" ")}`);
}

async function toolMessages(page, agentId) {
  return page.evaluate(async (id) => {
    const messages = await window.fid.messages.list(id);
    return messages.filter((message) => message.role === "tool").map((message) => message.content);
  }, agentId);
}

async function main() {
  const url = await startServer();
  const agentId = prepare(url);
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

    await startTurn(page, "Test the browser handoff now. Follow your instructions exactly.");
    const sawCard = await waitForHandoff(page);
    check("the live agent called browser_needs_you", sawCard);
    if (!sawCard) {
      const last = await lastAssistantText(page);
      throw new Error(`the turn ended without a handoff card: ${last.slice(0, 240)}`);
    }

    const card = page.locator('[aria-label="Needs you"]');
    const cardText = await card.innerText();
    check("the card shows the reason", /sign in/i.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 200));
    await shot(page, "01-handoff");

    await card.getByRole("button", { name: "Done" }).click();
    await card.waitFor({ state: "detached", timeout: 10_000 });
    check("Done closes the handoff card", true);
    await finishTurn(page);
    await watch(1500);

    const reply = await lastAssistantText(page);
    check("the live agent continued after Done", Boolean(reply.trim()), reply.replace(/\s+/g, " ").slice(0, 200));
    check(
      "the reply includes the page title",
      reply.toLowerCase().includes(pageTitle.toLowerCase()),
      reply.replace(/\s+/g, " ").slice(0, 240),
    );

    const tools = await toolMessages(page, agentId);
    check(
      "the transcript records the handoff and snapshot",
      tools.some((text) => text.includes("browser_needs_you")) &&
        tools.some((text) => text.includes("browser_snapshot")),
      tools.join(" | ").slice(0, 300),
    );
    check("the local page was requested", requests > 0, String(requests));
    await shot(page, "02-done");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("live run completed", false, message.slice(0, 240));
    console.error("HANDOFF LIVE E2E FAILED:", error);
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => undefined);
    if (vite) vite.kill();
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
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
  console.error("HANDOFF LIVE E2E FAILED:", error);
  process.exitCode = 1;
});
