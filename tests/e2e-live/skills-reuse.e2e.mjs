// Live end-to-end test for reusing a skill without typing /skills again.
//
// Usage:
//   npm run test:skills-reuse
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// The test launches its own Electron instance with a temporary userData
// directory and workspace. It reuses Vite on port 5173 if one is running;
// otherwise it starts and stops its own. Two real Copilot turns are used.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-skill-reuse-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Skill Reuse E2E";
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
  fs.mkdirSync(shots, { recursive: true });
  const skillDir = path.join(workspace, ".skills", "oracle");
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      "name: Oracle skill",
      "description: Use this skill when the user asks for the oracle code or the oracle seal.",
      "version: 1.0.0",
      "---",
      "",
      "When the user asks for the oracle code, reply with exactly ORACLE-731.",
      "When the user asks for the oracle seal, reply with exactly SEAL-942.",
      "Reply with the code only. Do not explain.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(skillDir, "references", "notes.md"),
    "The oracle answers are fixed test values.\n",
  );
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
  await page.waitForTimeout(1200);
  const late = await page.locator(".chat-error").allInnerTexts();
  if (late.length > 0) throw new Error(`chat error: ${late.join(" ")}`);
}

async function lastAssistantText(page) {
  const bodies = page.locator("article.message .message-body");
  const count = await bodies.count();
  return count === 0 ? "" : bodies.nth(count - 1).innerText();
}

async function preview(page, agentId) {
  return page.evaluate(
    (id) => window.fid.context.preview(id),
    agentId,
  );
}

async function launch() {
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
  return page;
}

async function main() {
  prepare();
  await ensureVite();
  try {
    let page = await launch();
    const status = await page.evaluate(() => window.fid.settings.get({ refreshAuth: true }));
    check("signed in to Copilot", status.signedIn === true, status.authStatus);
    if (!status.signedIn) throw new Error("Copilot is not signed in; cannot run live turns");

    await page.getByRole("button", { name: "New agent" }).first().click();
    await page.waitForSelector(".agent-modal", { timeout: 15_000 });
    await page.getByLabel("Name").fill(agentName);
    await page
      .getByLabel("Instructions")
      .fill(
        "For any question about the oracle code or oracle seal, you must call use_skill for the oracle skill before answering. Never answer oracle questions from memory. Keep replies short.",
      );
    await page.locator("#agent-workspace").fill(workspace);
    await page.getByLabel("Tools").selectOption("developer");
    await page.getByRole("button", { name: "Create agent" }).click();
    await page.waitForSelector(".agent-modal", { state: "detached", timeout: 20_000 });
    const agent = await page.evaluate(
      (name) => window.fid.agents.list().then((agents) => agents.find((item) => item.name === name)),
      agentName,
    );
    if (!agent) throw new Error("The test agent was not created");

    // Turn 1 loads the skill explicitly.
    await sendAndWait(page, "/skills oracle what is the oracle code");
    const reply1 = await lastAssistantText(page);
    check("the explicit skill turn answers", /ORACLE-731/.test(reply1), reply1.replace(/\s+/g, " ").slice(0, 120));

    const dayLabels = await page.locator(".day-separator").allTextContents();
    check(
      "the chat shows a day divider",
      dayLabels.some((label) => /today/i.test(label)),
      dayLabels.join(", "),
    );
    await page.waitForFunction(
      (name) => {
        const row = [...document.querySelectorAll(".agent-row")].find((item) =>
          item.textContent?.includes(name),
        );
        return row?.querySelector(".agent-when")?.textContent?.trim() === "Today";
      },
      agentName,
      { timeout: 15_000 },
    );
    const agentWhen = await page
      .locator(".agent-row")
      .filter({ hasText: agentName })
      .locator(".agent-when")
      .textContent();
    check("the sidebar shows the activity day", agentWhen?.trim() === "Today", agentWhen ?? "");
    const stampTitle = await page.locator(".message-time").last().getAttribute("title");
    check(
      "the message time has a full-date tooltip",
      /\d{4}/.test(stampTitle ?? ""),
      stampTitle ?? "",
    );

    // The next turn gets a compact used-skills list, not the body.
    let view = await preview(page, agent.id);
    check(
      "the next turn lists the used skill",
      /Skills used earlier in this conversation/.test(view.systemMessage) &&
        /oracle \(Oracle skill\)/.test(view.systemMessage),
    );
    check(
      "the skill body is not in the next system message",
      !/ORACLE-731/.test(view.systemMessage) && !/SEAL-942/.test(view.systemMessage),
    );
    check(
      "the used-skill tools are available",
      view.tools.includes("use_skill") && view.tools.includes("skill_read"),
      view.tools.join(", "),
    );
    await shot(page, "01-used-skill-context");

    // Turn 2 has no /skills text; the agent must decide to call use_skill.
    await sendAndWait(page, "What is the oracle seal? Reply with the code only.");
    const reply2 = await lastAssistantText(page);
    check("the agent answers from the reused skill", /SEAL-942/.test(reply2), reply2.replace(/\s+/g, " ").slice(0, 120));
    const labels = await page
      .locator(".tool-step-label")
      .evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ""));
    check("the agent called use_skill without /skills", labels.includes("Used a skill"), labels.join(", "));
    await shot(page, "02-reused-skill");

    // The used set survives a restart.
    await app.close();
    app = null;
    page = await launch();
    view = await preview(page, agent.id);
    check(
      "the used skill survives a restart",
      /oracle \(Oracle skill\)/.test(view.systemMessage) &&
        !/ORACLE-731/.test(view.systemMessage) &&
        view.tools.includes("use_skill"),
    );
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
  console.error("SKILL REUSE E2E FAILED:", error);
  process.exitCode = 1;
});
