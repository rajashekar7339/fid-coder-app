import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(appDir, "docs", "guide", "images");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-guide-"));

const vite = spawn(process.execPath, [path.join(appDir, "node_modules", "vite", "bin", "vite.js")], {
  cwd: appDir,
  stdio: ["ignore", "pipe", "pipe"],
});

let viteLog = "";
vite.stdout.on("data", (chunk) => {
  viteLog += chunk.toString();
});
vite.stderr.on("data", (chunk) => {
  viteLog += chunk.toString();
});

const deadline = Date.now() + 30000;
while (!viteLog.includes("5173") && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!viteLog.includes("5173")) {
  console.log(viteLog);
  vite.kill();
  throw new Error("Vite did not start");
}

const app = await electron.launch({
  executablePath: path.join(appDir, "node_modules", "electron", "dist", "electron.exe"),
  args: ["."],
  cwd: appDir,
  env: { ...process.env, FID_CODER_USER_DATA: userData },
});

try {
  const page = await app.firstWindow();
  await page.waitForSelector("text=JIRA Agent", { timeout: 20000 });
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) window.setSize(1400, 1000);
  });
  await page.waitForTimeout(500);

  fs.mkdirSync(outDir, { recursive: true });
  await captureAgentEditor(page);
  await seedDemoData(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=JIRA Agent", { timeout: 20000 });
  await page.getByRole("button", { name: /JIRA Agent/ }).first().click();
  await page.waitForSelector("text=FID-482", { timeout: 20000 });
  await page.waitForTimeout(800);

  const account = {
    name: await page.locator(".account-name").innerText().catch(() => ""),
    state: await page.locator(".account-state").innerText().catch(() => ""),
  };
  console.log(`Account row: ${account.name} / ${account.state}`);
  await page.evaluate(() => {
    const name = document.querySelector(".account-name");
    const avatar = document.querySelector(".user-avatar");
    if (name) name.textContent = "Copilot";
    if (avatar) avatar.textContent = "C";
  });

  await save(page.locator(".app-shell"), "cockpit.png");

  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) window.setSize(960, 900);
  });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /JIRA Agent/ }).first().click();
  await page.waitForTimeout(400);
  await save(page.locator(".thread"), "chat-tool-steps.png");

  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) window.setSize(1400, 1000);
  });
  await page.waitForTimeout(600);

  await page.getByRole("button", { name: "Manage routines" }).click();
  await page.locator(".routines-modal").waitFor({ state: "visible" });
  await page.waitForTimeout(500);
  await save(page.locator(".routines-modal"), "routines.png");
  await page.getByRole("button", { name: "Close routines" }).click();
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.locator(".settings-modal").waitFor({ state: "visible" });
  await page.waitForTimeout(900);
  const settingsState = await page.evaluate(async () => {
    const value = await window.fid.settings.get();
    return {
      signedIn: value.signedIn,
      loginName: value.loginName,
      hasGithubPat: value.hasGithubPat,
      hasJiraToken: value.hasJiraToken,
      jiraSiteUrl: value.jiraSiteUrl,
    };
  });
  console.log(`Settings state: ${JSON.stringify(settingsState)}`);
  await page.evaluate(() => {
    const cells = document.querySelectorAll(".connection-cell strong");
    if (cells[0]) cells[0].textContent = "Guide demo";
  });
  await save(page.locator(".settings-modal"), "settings.png");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: /GIT PR Review/ }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Actions for GIT PR Review" }).click();
  await page.getByRole("menuitem", { name: "Edit agent" }).click();
  const modal = page.locator(".agent-modal");
  await modal.waitFor({ state: "visible" });
  await page.addStyleTag({
    content:
      ".agent-modal { max-height: none !important; height: auto !important; } .agent-form-scroll { overflow: visible !important; }",
  });
  await modal.locator(".agent-form-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(600);
  await save(modal, "workspace-tools.png");
} finally {
  await app.close().catch(() => undefined);
  vite.kill();
  try {
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Chromium can hold the temp profile for a moment after the app closes.
  }
}

async function captureAgentEditor(page) {
  await page.getByRole("button", { name: "New agent" }).first().click();
  const modal = page.locator(".agent-modal");
  await modal.waitFor({ state: "visible" });
  await modal.getByLabel("Name").fill("Release notes");
  await modal.getByLabel("Role").fill("Release assistant");
  await modal
    .getByLabel("Instructions")
    .fill(
      "You are a release assistant. Read the changelog and open pull requests, then draft release notes with the main changes, risks, and testing gaps.",
    );
  await modal.getByLabel("Tools").selectOption("developer");
  await modal.locator("#agent-workspace").fill("D:\\Projects\\my-app");
  await page.addStyleTag({
    content:
      ".agent-modal { max-height: none !important; height: auto !important; } .agent-form-scroll { overflow: visible !important; }",
  });
  await modal.locator(".agent-form-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await modal.locator(".modal-header").click();
  await page.waitForTimeout(2500);
  await save(modal, "agent-editor.png");
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden" });
}

async function seedDemoData(page) {
  const agents = await page.evaluate(() => window.fid.agents.list());
  const jira = agents.find((agent) => agent.name === "JIRA Agent");
  const git = agents.find((agent) => agent.name === "GIT PR Review");
  if (!jira || !git) throw new Error("Seeded agents were not found");

  const database = new DatabaseSync(path.join(userData, "fid-coder.sqlite"));
  database.exec("PRAGMA busy_timeout = 5000");
  const now = Date.now();
  const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
  const insertMessage = database.prepare(
    "INSERT INTO messages (id, agent_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const messages = [
    ["user", "Draft a concise standup update and call out the release risk.", at(26)],
    ["tool", "browser_navigate: url: https://fid.atlassian.net/jira/your-work\ntitle: Jira — Your work", at(24)],
    ["tool", "browser_snapshot: Read 7 assigned issues\n(+14 more lines)", at(23)],
    ["tool", "browser_click: clicked text=Assigned to me on https://fid.atlassian.net/jira/your-work", at(22)],
    [
      "assistant",
      "Morning check is done. Three things need your attention before standup:\n\n- **FID-482 · Checkout retry loop** — QA flagged a duplicate charge when payments time out. This is the release blocker.\n- **FID-471 · Export job stuck** — Code-complete, waiting on a second approval.\n- **FID-456 · SSO group mapping** — Blocks onboarding for two new hires.\n\nToday: verify the retry fix with QA and unblock the export approval.",
      at(20),
    ],
    ["user", "Draft a short update for standup.", at(8)],
    [
      "assistant",
      "**Standup update**\n\n- Two release blockers are open: **FID-482** and **FID-456**.\n- **FID-471** is code-complete and waiting on a second approval.\n- Today: take ownership of FID-482 and confirm the retry fix with QA.\n\n> Release risk: High. **FID-482** needs verification today.",
      at(6),
    ],
  ];
  for (const [role, content, createdAt] of messages) {
    insertMessage.run(randomUUID(), jira.id, role, content, createdAt);
  }

  const insertRoutine = database.prepare(
    `INSERT INTO routines (
      id, agent_id, name, prompt, cron, enabled, notify, last_run_at, next_run_at, last_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tomorrow = new Date(now + 24 * 60 * 60_000);
  tomorrow.setHours(9, 0, 0, 0);
  const nextFriday = new Date(now);
  const fridayDelta = (5 - nextFriday.getDay() + 7) % 7 || 7;
  nextFriday.setDate(nextFriday.getDate() + fridayDelta);
  nextFriday.setHours(16, 0, 0, 0);
  const gitNext = new Date(now + 24 * 60 * 60_000);
  gitNext.setHours(10, 0, 0, 0);
  const createdAt = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
  const updatedAt = new Date(now).toISOString();

  insertRoutine.run(
    randomUUID(),
    jira.id,
    "Morning ticket sweep",
    "Check my assigned Jira tickets and summarize the top three.",
    "0 9 * * 1-5",
    1,
    1,
    at(24 * 60),
    tomorrow.toISOString(),
    "ok",
    createdAt,
    updatedAt,
  );
  insertRoutine.run(
    randomUUID(),
    jira.id,
    "Friday release notes",
    "Draft release notes from the changes merged this week.",
    "0 16 * * 5",
    0,
    1,
    at(7 * 24 * 60),
    null,
    "ok",
    createdAt,
    updatedAt,
  );
  insertRoutine.run(
    randomUUID(),
    git.id,
    "Review open pull requests",
    "Review the open pull requests and summarize the risky changes.",
    "0 10 * * 1-5",
    1,
    1,
    at(24 * 60),
    gitNext.toISOString(),
    "ok",
    createdAt,
    updatedAt,
  );

  database.prepare("UPDATE agents SET workspace_dir = ? WHERE id = ?").run("D:\\Projects\\my-app", git.id);
  database
    .prepare("UPDATE agents SET updated_at = ? WHERE id = ?")
    .run(new Date(now - 30 * 24 * 60 * 60_000).toISOString(), git.id);
  database.close();

  const secrets = await page.evaluate(async () => {
    try {
      await window.fid.settings.saveGithubPat("ghp_demo_guide_token");
      await window.fid.settings.saveJiraToken("jira_demo_guide_token");
      await window.fid.settings.saveJiraSite("https://fid.atlassian.net");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  console.log(`Secrets: ${JSON.stringify(secrets)}`);
}

async function save(locator, name) {
  const file = path.join(outDir, name);
  await locator.screenshot({ path: file, animations: "disabled" });
  const bytes = fs.statSync(file).size;
  console.log(`Wrote ${name} (${Math.round(bytes / 1024)} KB)`);
}
