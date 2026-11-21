// Live end-to-end test for Datadog browser mode, with no API keys.
//
// Usage:
//   npm run test:datadog-browser-live
//   FID_WATCH_MS=1500 npm run test:datadog-browser-live
//
// A local fake Datadog page emits a JSON log response. The Datadog Analyst
// opens it in the real headed browser, captures the response, reads a temp
// workspace, and reports the root cause. No Datadog account or key is used.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-datadog-browser-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Datadog Analyst";
const watchMs = Number(process.env.FID_WATCH_MS ?? 0);
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");

const results = [];
let vite = null;
let app = null;
let page = null;
let server = null;
let datadog = null;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function watch(ms = watchMs) {
  if (ms > 0) await sleep(ms);
}

function logPayload() {
  const at = new Date(Date.now() - 8 * 60_000).toISOString();
  return {
    data: [
      {
        id: "log-browser-1",
        type: "log",
        attributes: {
          timestamp: at,
          message: "TypeError: Cannot read properties of undefined (reading 'price')",
          service: "checkout-api",
          host: "checkout-7f9c",
          status: "error",
          tags: ["env:prod", "version:2.14.0"],
          attributes: {
            error: {
              kind: "TypeError",
              message: "Cannot read properties of undefined (reading 'price')",
              stack:
                "TypeError: Cannot read properties of undefined (reading 'price')\n    at applyDiscount (src/checkout.ts:9:18)\n    at handleCheckout (src/server.ts:31:5)",
            },
            http: { status_code: 500, method: "POST", url: "/api/v1/checkout" },
            trace_id: "trace-browser-1",
            "logger.name": "checkout.handler",
          },
        },
      },
    ],
  };
}

async function startDatadog() {
  const state = { requests: [], apiKey: null };
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    state.requests.push({ method: request.method, path: url.pathname, query: url.search });
    state.apiKey = request.headers["dd-api-key"] ?? null;
    if (request.method === "GET" && url.pathname === "/logs") {
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(`<!doctype html>
<html>
  <body style="font-family: system-ui; padding: 24px; background: #10151a; color: #d7e1ea">
    <h1>Fake Datadog Log Explorer</h1>
    <p>This page emits a JSON log response for the browser capture test.</p>
    <pre id="output" style="white-space: pre-wrap"></pre>
    <script>
      const params = new URLSearchParams(location.search);
      const query = params.get('query') || '*';
      fetch('/api/logs?query=' + encodeURIComponent(query))
        .then((response) => response.json())
        .then((data) => {
          document.getElementById('output').textContent = JSON.stringify(data, null, 2);
        });
    </script>
  </body>
</html>`);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/logs") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(logPayload()));
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { site: `http://127.0.0.1:${address.port}`, state };
}

function prepare() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "src", "checkout.ts"),
    [
      "type Item = { price: number };",
      "",
      "export type Order = {",
      "  items: Item[];",
      "};",
      "",
      "export function applyDiscount(order: Order): number {",
      "  const first = order.items[0];",
      "  return first.price * 0.9;",
      "}",
      "",
      "export function checkoutTotal(order: Order): number {",
      "  return applyDiscount(order);",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(workspace, "package.json"),
    JSON.stringify({ name: "checkout-api", private: true }, null, 2),
    "utf8",
  );
  spawnSync("git", ["init"], { cwd: workspace, stdio: "ignore" });
  spawnSync("git", ["add", "."], { cwd: workspace, stdio: "ignore" });
  spawnSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "checkout baseline"],
    { cwd: workspace, stdio: "ignore" },
  );

  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.listAgents().find((item) => item.name === agentName);
  if (!agent) throw new Error("the seeded Datadog Analyst is missing");
  db.updateAgent(agent.id, {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    workspaceDir: workspace,
    model: "auto",
    toolProfile: "datadog",
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
  vite.stdout.on("data", (chunk) => (log += chunk.toString()));
  vite.stderr.on("data", (chunk) => (log += chunk.toString()));
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

async function waitForAssistant(agentId, pattern, timeout = 300_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const list = await messages(agentId);
    if (list.some((message) => message.role === "assistant" && pattern.test(message.content))) {
      return list;
    }
    await sleep(1000);
  }
  throw new Error(`the assistant did not answer ${pattern}`);
}

async function waitForIdle() {
  await page.waitForFunction(
    () =>
      !document.querySelector('button[aria-label="Stop generating"]') &&
      !document.querySelector(".queue-panel"),
    null,
    { timeout: 300_000, polling: 500 },
  );
}

async function expandLastToolCard() {
  const card = page.locator(".tool-card").last();
  if ((await card.count()) === 0) return;
  const open = await card.evaluate((element) => element.hasAttribute("open"));
  if (!open) await card.locator("summary").first().click();
  const steps = card.locator(".tool-step");
  const count = await steps.count();
  for (let index = 0; index < count; index += 1) {
    const step = steps.nth(index);
    const stepOpen = await step.evaluate((element) => element.hasAttribute("open"));
    if (!stepOpen) await step.locator("summary").first().click();
  }
}

async function main() {
  try {
    const agentId = prepare();
    datadog = await startDatadog();
    await ensureVite();
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
    if (!status.signedIn) throw new Error("Copilot is not signed in; cannot run the live turn");

    await page.evaluate(
      async ({ site }) => {
        await window.fid.settings.saveDatadog({ url: site });
      },
      { site: datadog.site },
    );
    const configured = await page.evaluate(() => window.fid.settings.get());
    check(
      "browser mode is configured without keys",
      configured.datadogUrl === datadog.site,
      configured.datadogUrl,
    );

    await composerReady();
    await page.locator(".composer-input").fill(
      "Load the Datadog triage skill. Troubleshoot this incident: checkout-api is returning 500s for some orders in the last 30 minutes. Use datadog_browser_logs to read the fake Log Explorer page, then read the workspace and identify the root cause. Reply with the root cause in one short paragraph and cite the file and line.",
    );
    await watch();
    await page.locator(".composer-input").press("Enter");
    await waitForAssistant(agentId, /src\/checkout\.ts:(8|9)/, 300_000);
    await waitForIdle();
    const after = await messages(agentId);
    const tools = after.filter((message) => message.role === "tool").map((message) => message.content);
    check(
      "the agent called datadog_browser_logs",
      tools.some((content) => content.startsWith("datadog_browser_logs:")),
      tools.find((content) => content.startsWith("datadog_browser_logs:"))?.slice(0, 120),
    );
    check(
      "the browser capture reached the fake page",
      datadog.state.requests.some((request) => request.path === "/logs") &&
        datadog.state.requests.some((request) => request.path === "/api/logs"),
    );
    check(
      "the browser did not send an API key",
      datadog.state.apiKey === null,
      datadog.state.apiKey ?? "none",
    );
    check(
      "the agent read the workspace",
      tools.some((content) => /^(file_read|read_many|search_text|explore_code):/.test(content)),
      tools.find((content) => /^(file_read|read_many|search_text|explore_code):/.test(content))?.slice(0, 120),
    );
    check(
      "the agent named the empty-items root cause",
      after.some(
        (message) =>
          message.role === "assistant" &&
          /items\[0\]|empty|undefined|no items/i.test(message.content),
      ),
    );
    check(
      "the answer labels browser results as a sample or page",
      after.some(
        (message) =>
          message.role === "assistant" &&
          /sample|page|browser/i.test(message.content),
      ),
    );
    await expandLastToolCard();
    await watch(1200);
    await page.locator(".chat-scroll").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await shot("01-datadog-browser-root-cause");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("live Datadog browser run completed", false, message.slice(0, 240));
    console.error("DATADOG BROWSER LIVE E2E FAILED:", error);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve)).catch(() => undefined);
    }
    if (app) await app.close().catch(() => undefined);
    if (vite) vite.kill();
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  console.log(`ARTIFACTS: ${root}`);
  if (failed.length === 0) {
    console.log("ALL DATADOG BROWSER LIVE CHECKS PASSED");
  }
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main();
