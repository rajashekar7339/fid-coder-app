// Live end-to-end test for the native spreadsheet and Confluence tools.
//
// Usage:
//   npm run test:native-live
//   FID_WATCH_MS=1500 npm run test:native-live
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// The Confluence side uses a local fake REST server. It never contacts a real
// wiki and never needs a real token. The CSV side reads a file in the temp
// workspace. Both turns are real Copilot turns.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-native-data-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Native Data Live";
const watchMs = Number(process.env.FID_WATCH_MS ?? 0);
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");

const results = [];
let vite = null;
let app = null;
let page = null;
let server = null;
let confluence = null;

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

function confluencePage(state) {
  return {
    id: "p1",
    type: "page",
    title: "Release notes",
    space: { key: "DOCS", name: "Docs" },
    version: { number: state.version },
    body: {
      storage: { value: state.storage },
      view: { value: state.storage },
    },
    _links: { webui: "/spaces/DOCS/pages/p1" },
  };
}

async function startConfluence() {
  const state = {
    version: 3,
    storage: "<h1>Release</h1><p>Alpha &amp; beta</p>",
    requests: [],
    authorization: null,
  };
  server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const route = url.pathname.replace(/^\/wiki(?=\/rest\/)/, "");
    let body = "";
    for await (const chunk of request) body += chunk;
    state.requests.push({ method: request.method, path: url.pathname, query: url.search, body });
    state.authorization = request.headers.authorization ?? null;
    response.setHeader("content-type", "application/json");

    if (request.method === "GET" && route === "/x/live") {
      response.statusCode = 302;
      response.setHeader("location", "/spaces/DOCS/pages/p1");
      response.end();
      return;
    }
    if (request.method === "GET" && route === "/rest/api/content/search") {
      response.end(JSON.stringify({ results: [confluencePage(state)] }));
      return;
    }
    if (request.method === "GET" && route === "/rest/api/content") {
      response.end(JSON.stringify({ results: [confluencePage(state)] }));
      return;
    }
    if (request.method === "GET" && route === "/rest/api/content/p1") {
      response.end(JSON.stringify(confluencePage(state)));
      return;
    }
    if (request.method === "PUT" && route === "/rest/api/content/p1") {
      const parsed = JSON.parse(body);
      state.version = parsed.version.number;
      state.storage = parsed.body.storage.value;
      response.end(JSON.stringify(confluencePage(state)));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return { site: `http://127.0.0.1:${address.port}`, state };
}

function prepare() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "sales.csv"),
    "Region,Amount\nNorth,120\nSouth,80\nEast,40\n",
    "utf8",
  );
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Native table and Confluence live test",
    systemPrompt:
      "You are a concise live test agent. Follow the user's tool instructions exactly. Use table_read for spreadsheets and the Confluence tools for wiki pages. Keep replies short.",
    workspaceDir: workspace,
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

async function waitForAssistant(agentId, pattern, timeout = 240_000) {
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
    { timeout: 240_000, polling: 500 },
  );
}

async function waitForVersion(version, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (confluence.state.version === version) return true;
    await sleep(500);
  }
  return false;
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
    confluence = await startConfluence();
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
    if (!status.signedIn) throw new Error("Copilot is not signed in; cannot run the live turns");

    await page.evaluate(
      async ({ site }) => {
        await window.fid.settings.saveConfluence({ siteUrl: site, email: "", mode: "data-center" });
        await window.fid.settings.saveConfluenceToken("local-confluence-token");
      },
      { site: confluence.site },
    );
    const configured = await page.evaluate(() => window.fid.settings.get());
    check("the local Confluence connection is configured", configured.hasConfluenceToken === true);

    await composerReady();
    await page.locator(".composer-input").fill(
      "Use table_read to read sales.csv. What amount does the South region have? Reply with just the number.",
    );
    await watch();
    await page.locator(".composer-input").press("Enter");
    await waitForAssistant(agentId, /\b80\b/);
    await waitForIdle();
    const afterCsv = await messages(agentId);
    check(
      "the agent called table_read",
      afterCsv.some((message) => message.role === "tool" && message.content.startsWith("table_read:")),
    );
    check(
      "the CSV answer used the South row",
      afterCsv.some((message) => message.role === "assistant" && /\b80\b/.test(message.content)),
    );
    await expandLastToolCard();
    await watch(1200);
    await shot("01-csv-table");

    await composerReady();
    await page.locator(".composer-input").fill(
      `Read this Confluence page ${confluence.site}/x/live with confluence_page using its url. Then append exactly 'Live check from Fid Coder.' with confluence_update_page using the current expectedVersion, mode=append, and format=markdown. Keep the title. Use no other tools. When the update finishes, reply with one short sentence confirming the page is updated.`,
    );
    await watch();
    await page.locator(".composer-input").press("Enter");
    await page.waitForSelector(".approval-card", { timeout: 180_000 });
    await watch(1500);
    await shot("02-confluence-approval");
    await page.getByRole("button", { name: "Allow once" }).click();

    const updated = await waitForVersion(4);
    await waitForIdle();
    const afterConfluence = await messages(agentId);
    check("the agent called confluence_page", afterConfluence.some(
      (message) => message.role === "tool" && message.content.startsWith("confluence_page:"),
    ));
    check(
      "the agent used the pasted short link",
      confluence.state.requests.some((request) => request.path === "/x/live"),
    );
    check("the agent called confluence_update_page", afterConfluence.some(
      (message) => message.role === "tool" && message.content.startsWith("confluence_update_page:"),
    ));
    check("the update reached Confluence as version 4", updated, `version ${confluence.state.version}`);
    check(
      "the appended text is in the page",
      confluence.state.storage.includes("Live check from Fid Coder."),
      confluence.state.storage.slice(0, 180),
    );
    check("the fake Confluence saw the PAT", confluence.state.authorization === "Bearer local-confluence-token");
    check(
      "the token never appears in chat",
      afterConfluence.every((message) => !message.content.includes("local-confluence-token")),
    );
    const finalReply = [...afterConfluence].reverse().find((message) => message.role === "assistant");
    check(
      "the agent confirmed the update",
      Boolean(finalReply && finalReply.content.trim() && finalReply.content.trim() !== "No response."),
      finalReply?.content.slice(0, 120),
    );
    await expandLastToolCard();
    await watch(1200);
    await page
      .waitForFunction(
        () => {
          const meta = document.querySelector(".approval-desk-meta");
          return Boolean(meta && !/Waiting/.test(meta.textContent ?? ""));
        },
        null,
        { timeout: 10_000 },
      )
      .catch(() => undefined);
    await page.locator(".chat-scroll").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await shot("03-confluence-updated");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("live native-data run completed", false, message.slice(0, 240));
    console.error("NATIVE DATA LIVE E2E FAILED:", error);
    process.exitCode = 1;
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve)).catch(() => undefined);
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
  console.error("NATIVE DATA LIVE E2E FAILED:", error);
  process.exitCode = 1;
});
