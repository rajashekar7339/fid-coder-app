// Live end-to-end test for the Enhance Prompt composer action.
//
// Usage:
//   npm run test:enhance
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// One real Copilot rewrite is used. The remaining checks are skips or UI state.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-enhance-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Enhance E2E";
const clean = process.env.FID_CLEAN === "1";
const roughDraft =
  "so basically the login page is broken whenever the session cookie expires and then it keeps redirecting in a loop and I was wondering if you could take a look at the whole flow and maybe figure out what is going on and fix it please thanks";

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

async function composerValue(page) {
  return page.locator(".composer-input").inputValue();
}

async function main() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
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

    const status = await page.evaluate(() => window.fid.settings.get({ refreshAuth: true }));
    check("signed in to Copilot", status.signedIn === true, status.authStatus);
    if (!status.signedIn) throw new Error("Copilot is not signed in; cannot run a live rewrite");

    await page.evaluate(
      (folder) =>
        window.fid.agents.create({
          name: "Enhance E2E",
          description: "Temporary agent for the enhance check",
          systemPrompt: "Reply briefly.",
          workspaceDir: folder,
          model: "auto",
          toolProfile: "developer",
          memoryEnabled: false,
        }),
      workspace,
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-shell", { timeout: 60_000 });
    await page.locator(".agent-row").filter({ hasText: agentName }).first().click();
    await page.waitForFunction(
      (name) => document.querySelector(".chat-title h1")?.textContent?.trim() === name,
      agentName,
      { timeout: 15_000 },
    );

    const enhanceButton = page.getByRole("button", { name: "Enhance prompt" });
    await page.locator(".composer-input").fill(roughDraft);
    check("enhance is enabled for a draft", await enhanceButton.isEnabled());
    check("enhance starts with an empty thread", (await page.locator(".user-bubble").count()) === 0);

    await enhanceButton.click();
    await page.waitForFunction(
      (original) => {
        const input = document.querySelector(".composer-input");
        const button = document.querySelector('button[aria-label="Enhance prompt"]');
        return (
          input instanceof HTMLTextAreaElement &&
          input.value.trim().length > 0 &&
          input.value !== original &&
          !button?.textContent?.includes("Enhancing")
        );
      },
      roughDraft,
      { timeout: 60_000, polling: 300 },
    );
    const enhanced = await composerValue(page);
    check("enhance rewrites the draft", enhanced !== roughDraft && enhanced.length > 0, enhanced.slice(0, 120));
    check(
      "enhance shows the undo action",
      (await page.getByRole("button", { name: "Undo" }).count()) === 1,
    );
    check("enhance does not send the draft", (await page.locator(".user-bubble").count()) === 0);
    await shot(page, "01-enhanced");

    await page.getByRole("button", { name: "Undo" }).click();
    await page.waitForFunction(
      (original) => document.querySelector(".composer-input")?.value === original,
      roughDraft,
      { timeout: 10_000 },
    );
    check("undo restores the draft", (await composerValue(page)) === roughDraft);

    await page.locator(".composer-input").fill("/help");
    await enhanceButton.click();
    await page.waitForFunction(
      () => document.querySelector(".enhance-hint")?.textContent?.includes("Commands are sent as written"),
      { timeout: 10_000 },
    );
    check("a command is skipped", (await composerValue(page)) === "/help");
    check("skips do not send a message", (await page.locator(".user-bubble").count()) === 0);
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
  console.error("ENHANCE E2E FAILED:", error);
  process.exitCode = 1;
});
