// Live end-to-end test for the DeepSeek provider.
//
// Usage:
//   npm run test:deepseek-live
//
// Requirements:
//   - DEEP_SEEK_API_KEY in .env (or the environment), or a key saved in Settings.
//   - `npm run build:node` output present (the npm script runs it).
//
// This is a real DeepSeek turn through the Copilot SDK's BYOK path. It proves
// the provider switch, a tool call, streaming, and token usage, without a
// Copilot sign-in.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
try {
  process.loadEnvFile(path.join(appDir, ".env"));
} catch {
  // .env is optional; the environment may already have the key.
}

const apiKey = process.env.DEEP_SEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.log("BLOCKED DeepSeek key missing. Put DEEP_SEEK_API_KEY in .env.");
  process.exit(2);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-deepseek-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "DeepSeek Live";
const imagePath = path.join(appDir, "assets", "app-icon", "icon.png");
const watchMs = Number(process.env.FID_WATCH_MS ?? 0);
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");
const { DEEPSEEK_DEFAULT_MODEL } = require("../../dist/shared/providers.js");

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

async function watch(ms = watchMs) {
  if (ms > 0) await sleep(ms);
}

function prepare() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(path.join(workspace, "hello.txt"), "deepseek-e2e-ok\n", "utf8");
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "DeepSeek live test",
    systemPrompt:
      "You are a concise live test agent. Follow the user's tool instructions exactly. Use file_read to read the workspace file. Keep replies short.",
    workspaceDir: workspace,
    provider: "deepseek",
    model: DEEPSEEK_DEFAULT_MODEL,
    toolProfile: "developer",
    readOnly: true,
    memoryEnabled: false,
  });
  const saved = db.getAgent(agent.id);
  db.close();
  return saved;
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

async function send(text) {
  await composerReady();
  await page.locator(".composer-input").fill(text);
  await watch();
  await page.locator(".composer-input").press("Enter");
}

async function main() {
  try {
    const agent = prepare();
    check("the agent stores the DeepSeek provider", agent?.provider === "deepseek", agent?.provider);
    check("the agent stores the DeepSeek default model", agent?.model === DEEPSEEK_DEFAULT_MODEL, agent?.model);

    await ensureVite();
    app = await electron.launch({
      executablePath: path.join(appDir, "node_modules", "electron", "dist", "electron.exe"),
      args: ["."],
      cwd: appDir,
      env: {
        ...process.env,
        FID_CODER_USER_DATA: userData,
        FID_CODER_ATTACH_IMPORT_FILES: imagePath,
      },
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

    const settings = await page.evaluate(() => window.fid.settings.get({ refreshAuth: true }));
    check("the DeepSeek key is available", settings.hasDeepseekKey === true);
    check("the key source is the environment", settings.deepseekKeySource === "environment", settings.deepseekKeySource);
    const status = await page.locator(".status-pill").first().innerText().catch(() => "");
    check("the chat shows Ready", status.trim().toLowerCase() === "ready", status);

    await send(
      "Use file_read to read hello.txt. Reply with only the exact contents, with no extra words.",
    );
    const afterRead = await waitForAssistant(agent.id, /deepseek-e2e-ok/);
    await waitForIdle();
    check(
      "the agent called file_read",
      afterRead.some((message) => message.role === "tool" && message.content.startsWith("file_read:")),
    );
    check(
      "the answer contains the file text",
      afterRead.some(
        (message) => message.role === "assistant" && /deepseek-e2e-ok/.test(message.content),
      ),
    );
    const usage = [...afterRead].reverse().find((message) => message.role === "assistant" && message.usage)?.usage;
    check("the turn reported DeepSeek usage", usage?.provider === "deepseek", JSON.stringify(usage));
    check("the turn reported input tokens", Number(usage?.inputTokens) > 0, String(usage?.inputTokens));
    check("the turn has no Copilot credits", usage?.creditStatus === "unavailable", usage?.creditStatus);
    await shot("01-deepseek-tool");

    const options = await page
      .locator(".model-picker-compact select option")
      .evaluateAll((items) => items.map((item) => ({ value: item.value, text: item.textContent ?? "" })));
    check(
      "the composer offers a DeepSeek model",
      options.some((option) => /deepseek/i.test(option.text)),
      JSON.stringify(options),
    );
    check("the DeepSeek picker has no Auto", options.every((option) => option.value !== "auto"), JSON.stringify(options));
    const selectedModel = await page.locator(".model-picker-compact select").inputValue();
    check("the composer selected the DeepSeek default", selectedModel === DEEPSEEK_DEFAULT_MODEL, selectedModel);

    await send("Reply with only the number 4.");
    const afterMath = await waitForAssistant(agent.id, /\b4\b/);
    await waitForIdle();
    check(
      "the second DeepSeek turn answered",
      afterMath.some((message) => message.role === "assistant" && /\b4\b/.test(message.content)),
    );
    await shot("02-deepseek-second-turn");

    await composerReady();
    await page.getByRole("button", { name: "Attach files" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".composer-attachment, .attachment-chip").length > 0,
      null,
      { timeout: 10_000 },
    );
    await send("What color is the rounded square in the attached image? Reply with one word.");
    const afterImage = await waitForAssistant(agent.id, /lime|green/i);
    await waitForIdle();
    const imageChips = await page
      .locator(".user-message")
      .last()
      .locator(".user-attachment")
      .allInnerTexts();
    check(
      "the image attachment is on the user message",
      imageChips.some((chip) => /icon\.png/.test(chip)),
      imageChips.join(" | "),
    );
    check(
      "DeepSeek Flash read the image",
      afterImage.some((message) => message.role === "assistant" && /lime|green/i.test(message.content)),
    );
    await shot("03-deepseek-image");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check("live DeepSeek run completed", false, message.slice(0, 240));
    console.error("DEEPSEEK LIVE E2E FAILED:", error);
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
  console.error("DEEPSEEK LIVE E2E FAILED:", error);
  process.exitCode = 1;
});
