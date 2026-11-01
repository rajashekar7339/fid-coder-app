// Live end-to-end test for the plan strip, turn changes/revert, workspace rules,
// and the context inspector.
//
// Usage:
//   npm run test:features            # two real Copilot turns
//   FID_SKIP_TURNS=1 npm run test:features   # launch/UI setup only
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// The test launches its own Electron instance with a temporary userData
// directory, so it does not touch the app you are using. It reuses Vite on
// port 5173 if one is running; otherwise it starts and stops its own.
// Screenshots and logs stay under the printed ARTIFACTS directory.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-features-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Live Test Agent";
const skipTurns = process.env.FID_SKIP_TURNS === "1";
const clean = process.env.FID_CLEAN === "1";

const results = [];
let vite = null;
let app = null;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function prepare() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(path.join(workspace, "demo.ts"), "export const greeting = 'hello';\n", "utf8");
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

async function ensureAgentSelected(page) {
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
  await page.waitForTimeout(1500);
  const late = await page.locator(".chat-error").allInnerTexts();
  if (late.length > 0) throw new Error(`chat error: ${late.join(" ")}`);
}

async function lastAssistantText(page) {
  const bodies = page.locator("article.message .message-body");
  const count = await bodies.count();
  return count === 0 ? "" : bodies.nth(count - 1).innerText();
}

async function waitForChangeCount(page, expected, timeout = 15_000) {
  await page.waitForFunction(
    (n) => document.querySelectorAll(".change-row").length === n,
    expected,
    { timeout, polling: 300 },
  );
}

async function main() {
  prepare();
  try {
    await ensureVite();
    app = await electron.launch({
      executablePath: path.join(appDir, "node_modules", "electron", "dist", "electron.exe"),
      args: [appDir],
      cwd: appDir,
      env: { ...process.env, FID_CODER_USER_DATA: userData },
      timeout: 60_000,
    });
    const page = await app.firstWindow({ timeout: 60_000 });
    page.on("pageerror", (error) => console.log("[pageerror]", error.message));
    await page.waitForSelector(".app-shell", { timeout: 60_000 });

    const status = await page.evaluate(() => window.fid.settings.get({ refreshAuth: true }));
    check("signed in to Copilot", status.signedIn === true, status.authStatus);
    if (!status.signedIn) throw new Error("Copilot is not signed in; cannot run live turns");

    const agent = await page.evaluate(
      (folder) =>
        window.fid.agents.create({
          name: "Live Test Agent",
          description: "Temporary agent for UI verification",
          systemPrompt:
            "You are a careful coding agent. Use tools when asked. For every task with multiple steps, call set_plan first and update it as you go. Keep replies short.",
          workspaceDir: folder,
          model: "auto",
          toolProfile: "developer",
          memoryEnabled: false,
        }),
      workspace,
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await ensureAgentSelected(page);
    await shot(page, "01-home");

    check("new sections are present", agent.id.length > 0);
    check(
      "disconnected workspace has an empty changes state",
      (await page.locator(".change-row").count()) === 0,
    );

    if (skipTurns) {
      console.log("FID_SKIP_TURNS=1: skipping Copilot turns");
      return;
    }

    // ---- Turn 1: plan + file changes ----
    await sendAndWait(
      page,
      [
        "Use set_plan for this task before doing anything.",
        "Steps:",
        "1. Read demo.ts with file_read.",
        "2. Use apply_patch to change \"export const greeting = 'hello';\" to \"export const greeting = 'hi';\".",
        "3. Use file_write to create notes.md containing exactly: first note",
        "Do not use shell_run. Mark each plan step done as you finish it. Keep the final reply to one short sentence.",
      ].join("\n"),
    );

    const reply1 = await lastAssistantText(page);
    check("turn 1 produced an assistant reply", reply1.trim().length > 0, reply1.replace(/\s+/g, " ").slice(0, 120));

    const planCount = await page.locator(".plan-strip").count();
    check("plan strip is visible", planCount > 0);
    if (planCount > 0) {
      await page.locator(".plan-head").click();
      await page.waitForTimeout(300);
      const planText = await page.locator(".plan-strip").innerText();
      check(
        "plan lists the requested steps",
        /demo\.ts|file_read|hello|notes\.md/i.test(planText),
        planText.replace(/\s+/g, " ").slice(0, 160),
      );
      await shot(page, "02-plan");
    }

    const demoAfterTurn = fs.readFileSync(path.join(workspace, "demo.ts"), "utf8");
    const notesPath = path.join(workspace, "notes.md");
    check("apply_patch changed demo.ts", demoAfterTurn.includes("'hi'"), demoAfterTurn.trim());
    check(
      "file_write created notes.md",
      fs.existsSync(notesPath),
      fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf8").trim() : "missing",
    );

    if ((await page.locator(".agent-desk").count()) === 0) {
      await page.locator('button[aria-label="Show agent desk"]').click();
      await page.waitForSelector(".agent-desk", { timeout: 10_000 });
    }
    await page.waitForFunction(() => document.querySelectorAll(".change-row").length > 0, {
      timeout: 20_000,
      polling: 500,
    });
    await page.waitForFunction(
      () => {
        const row = [...document.querySelectorAll(".change-row")].find((item) =>
          item.textContent?.includes("demo.ts"),
        );
        return Boolean(row && /\+1/.test(row.textContent ?? ""));
      },
      { timeout: 15_000, polling: 300 },
    );
    const changeRows = await page.locator(".change-row").allInnerTexts();
    check("changes section lists both files", changeRows.length === 2, JSON.stringify(changeRows));
    await page.waitForTimeout(250);
    await shot(page, "03-changes");

    await page.locator(".change-row").filter({ hasText: "demo.ts" }).first().click();
    await page.waitForSelector(".diff-modal", { timeout: 10_000 });
    const diffText = await page.locator(".diff-modal .diff-lines").innerText();
    check(
      "diff shows the old and new line",
      /hello/.test(diffText) && /hi/.test(diffText),
      diffText.replace(/\s+/g, " ").slice(0, 160),
    );
    await page.waitForTimeout(250);
    await shot(page, "04-diff");

    await page.locator('.diff-modal button:has-text("Revert file")').click();
    await page.waitForSelector(".confirm-modal", { timeout: 10_000 });
    await page.waitForTimeout(250);
    await shot(page, "05-revert-confirm");
    await page.locator(".confirm-modal .btn-destructive").click();
    await page.waitForSelector(".confirm-modal", { state: "detached", timeout: 20_000 });
    await page.waitForSelector(".diff-modal", { state: "detached", timeout: 20_000 });
    await waitForChangeCount(page, 1);
    const demoRestored = fs.readFileSync(path.join(workspace, "demo.ts"), "utf8");
    check(
      "revert file restored demo.ts",
      demoRestored.includes("'hello'") && !demoRestored.includes("'hi'"),
      demoRestored.trim(),
    );
    check("revert file left notes.md alone", fs.existsSync(notesPath));

    await page.locator('.agent-desk button:has-text("Revert turn")').click();
    await page.waitForSelector(".confirm-modal", { timeout: 10_000 });
    await page.locator(".confirm-modal .btn-destructive").click();
    await waitForChangeCount(page, 0, 20_000);
    check("revert turn removed created notes.md", !fs.existsSync(notesPath));
    await shot(page, "06-changes-empty");

    // ---- Turn 2: workspace rules + context inspector ----
    fs.writeFileSync(
      path.join(workspace, "AGENTS.md"),
      "# Workspace rules\nAlways begin every answer with the word BANANA.\n",
      "utf8",
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await ensureAgentSelected(page);
    await page.waitForSelector(".agent-desk", { timeout: 15_000 });
    await page.waitForSelector(".rule-row", { timeout: 15_000 });
    const ruleRows = await page.locator(".rule-row").allInnerTexts();
    check("project rules lists AGENTS.md", ruleRows.some((row) => row.includes("AGENTS.md")), JSON.stringify(ruleRows));
    check("plan persisted across reload", (await page.locator(".plan-strip").count()) > 0);

    await sendAndWait(page, "What is 2 + 2? Answer in one short sentence.");
    const reply2 = await lastAssistantText(page);
    check("rules were applied to the turn", /banana/i.test(reply2), reply2.replace(/\s+/g, " ").slice(0, 160));

    const planAfterTurn2 = await page.locator(".plan-strip").count();
    check("plan stays visible on a second message", planAfterTurn2 > 0);
    if (planAfterTurn2 > 0) {
      const planHead = page.locator(".plan-head");
      if ((await planHead.getAttribute("aria-expanded")) !== "true") await planHead.click();
      await page.locator(".plan-steps").waitFor({ state: "visible", timeout: 5_000 });
      const planText2 = await page.locator(".plan-steps").innerText();
      check(
        "plan keeps the first turn's steps",
        /demo\.ts|notes\.md/i.test(planText2),
        planText2.replace(/\s+/g, " ").slice(0, 160),
      );
    }

    await page.locator('.agent-desk button:has-text("Context")').click();
    await page.waitForSelector(".context-modal", { timeout: 15_000 });
    await page.waitForSelector(".context-modal .context-block", { timeout: 30_000 });
    await page.waitForTimeout(400);
    const contextText = await page.locator(".context-modal .context-body").innerText();
    check("context shows project rules", /Project rules/.test(contextText) && /BANANA/.test(contextText));
    check("context shows the set_plan tool", /set_plan/.test(contextText));
    check("context shows the workspace brief", /Workspace brief/.test(contextText));
    await shot(page, "07-context");
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
  console.error("FEATURE SMOKE FAILED:", error);
  process.exitCode = 1;
});
