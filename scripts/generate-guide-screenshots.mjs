// Regenerates the screenshots used by the in-app guide.
//
// Usage:
//   node scripts/generate-guide-screenshots.mjs
//
// Requirements: `npm install` and a free port 5173. The script launches its
// own Vite server and Electron instance, seeds demo data in a temporary
// userData directory, and overwrites the images in docs/guide/images.
//
// queue-while-running.png is captured by `npm run test:queue-live`; it needs a
// real running turn, so this seeded-data script cannot produce it.
// message-actions.png is captured by `npm run test:message-actions`; it needs
// chat turns and the inline editor, so this seeded-data script cannot produce it.
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

writeDemoSkill(
  "release-notes",
  "Release notes",
  "Draft release notes from merged pull requests.",
  "1.2.0",
  "Read the pull request titles and write three short sections: changes, risks, and testing gaps.",
);
fs.mkdirSync(path.join(userData, "skills", "release-notes", "references"), { recursive: true });
fs.writeFileSync(
  path.join(userData, "skills", "release-notes", "references", "template.md"),
  "# Release notes\n\n## Changes\n\n## Risks\n\n## Testing gaps\n",
);
writeDemoSkill(
  "test-plan",
  "Test plan",
  "Turn acceptance criteria into a short test plan.",
  "2.0.1",
  "List the happy path, edge cases, and the one regression that would block release.",
);

let vite = null;
await ensureVite();

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
  // Start the thread at the top so the sticky day label sits above the messages
  // in the full-thread capture instead of covering them.
  await page.locator(".chat-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(250);
  await save(page.locator(".thread"), "chat-tool-steps.png");

  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window) window.setSize(1400, 1000);
  });
  await page.waitForTimeout(600);

  await page.getByRole("button", { name: /Code Assistant/ }).first().click();
  await page.waitForSelector(".chat-empty", { timeout: 15000 });
  await page.waitForTimeout(400);
  await save(page.locator(".chat-pane"), "ask-mode.png");

  await page.getByRole("button", { name: "Open project map" }).click();
  await page.locator(".project-map-modal").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => Boolean(document.querySelector(".project-map-modal .mermaid-diagram svg")),
    { timeout: 20000 },
  );
  await page.waitForTimeout(500);
  await save(page.locator(".project-map-modal"), "project-map.png");
  await page.getByRole("button", { name: "Close project map" }).click();
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: /JIRA Agent/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Manage routines" }).click();
  await page.locator(".routines-modal").waitFor({ state: "visible" });
  await page.locator(".routines-nav-item").filter({ hasText: "Morning ticket sweep" }).click();
  await page.waitForTimeout(300);
  await save(page.locator(".routines-modal"), "routines.png");
  await page.locator(".routines-nav-item").filter({ hasText: "Afternoon reminder" }).click();
  await page.waitForTimeout(300);
  await save(page.locator(".routines-modal"), "routines-once.png");
  await page
    .locator(".routines-modal")
    .getByRole("button", { name: "History", exact: true })
    .click();
  await page.waitForSelector(".routine-history-row", { timeout: 10000 });
  await page.waitForTimeout(300);
  await save(page.locator(".routines-modal"), "routine-history.png");
  await page.getByRole("button", { name: "Close routines" }).click();
  await page.waitForTimeout(300);

  await page.locator(".composer-input").fill("/routine");
  await page.waitForSelector(".command-menu .command-row", { timeout: 10_000 });
  await page.waitForTimeout(300);
  await saveRegion(page, [".command-menu", ".composer-dock"], "routine-command.png");
  await page.locator(".composer-input").fill("");
  await page.waitForTimeout(200);

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

  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "hidden" });
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: /JIRA Agent/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Actions for JIRA Agent" }).click();
  await page.getByRole("menuitem", { name: "Edit agent" }).click();
  const factsModal = page.locator(".agent-modal");
  await factsModal.waitFor({ state: "visible" });
  await factsModal.locator(".fact-row").first().waitFor({ state: "visible" });
  await page.addStyleTag({
    content:
      ".agent-modal { max-height: none !important; height: auto !important; } .agent-form-scroll { overflow: visible !important; }",
  });
  await factsModal.locator(".agent-form-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(500);
  await save(factsModal, "agent-facts.png");
  await page.keyboard.press("Escape");
  await factsModal.waitFor({ state: "hidden" });
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: /JIRA Agent/ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Open skills" }).click();
  await page.locator(".skills-modal").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll(".skill-card").length >= 4, { timeout: 20000 });
  await page.locator(".skill-card", { hasText: "Release notes" }).locator(".skill-card-copy").click();
  await page.locator(".skills-modal .skill-reader pre").waitFor({ state: "visible" });
  await page.evaluate(() => {
    const path = document.querySelector(".skill-reader-path");
    if (path) path.textContent = "%USERPROFILE%\\.fid_coder_app\\skills\\release-notes\\SKILL.md";
  });
  await page.waitForTimeout(400);
  await save(page.locator(".skills-modal"), "skills-library.png");
  await page.locator(".skill-card", { hasText: "Release notes" }).getByRole("button", { name: "Use" }).click();
  await page.waitForSelector(".skills-modal", { state: "detached" });
  await page.waitForFunction(
    () => document.querySelector(".composer-input")?.value === "/skills release-notes ",
    { timeout: 10000 },
  );
  await page.waitForTimeout(400);
  await save(page.locator(".composer-dock"), "skills-use.png");
  await page.locator(".composer-input").fill(
    "so basically the login page is broken whenever the session cookie expires and then it keeps redirecting in a loop and I was wondering if you could take a look at the whole flow and fix it please thanks",
  );
  await page.waitForTimeout(300);
  await save(page.locator(".composer-dock"), "enhance-prompt.png");
  await page.locator(".composer-input").fill("");
  await page.waitForTimeout(200);

  // A real turn is not needed to show the sidebar state. Stub the running set
  // for the poll, then select another agent so the working row is not active.
  const demoAgents = await page.evaluate(() => window.fid.agents.list());
  const jiraAgent = demoAgents.find((agent) => agent.name === "JIRA Agent");
  if (!jiraAgent) throw new Error("JIRA Agent was not found");
  await page.getByRole("button", { name: /GIT PR Review/ }).first().click();
  await page.waitForTimeout(300);
  await app.evaluate(
    ({ ipcMain }, { channel, agentId }) => {
      try {
        ipcMain.removeHandler(channel);
      } catch {
        // No handler in an older build; handle() below is enough.
      }
      ipcMain.handle(channel, () => [agentId]);
    },
    { channel: "chat:running-all", agentId: jiraAgent.id },
  );
  await page.waitForSelector(".agent-row.is-working", { timeout: 5000 });
  await page.waitForTimeout(300);
  await save(page.locator(".sidebar"), "sidebar-working.png");
} finally {
  await app.close().catch(() => undefined);
  if (vite) vite.kill();
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
  await modal.getByRole("button", { name: "Release notes", exact: true }).click();
  await modal
    .locator(".agent-mode-switch")
    .getByRole("button", { name: "Agent mode", exact: true })
    .click();
  await modal.getByRole("radio", { name: /^Shell, search, git, and files/ }).click();
  await modal.locator("#agent-workspace").fill("D:\\Projects\\my-app");
  await page.addStyleTag({
    content:
      ".agent-modal { max-height: none !important; height: auto !important; } .agent-form-scroll { overflow: visible !important; }",
  });
  await modal.locator(".agent-form-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await modal.getByLabel("Name").evaluate((element) => element.blur());
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
  const insertTurn = database.prepare(
    "INSERT INTO turns (id, agent_id, source, started_at, ended_at, status) VALUES (?, ?, 'chat', ?, ?, 'ok')",
  );
  const firstTurn = randomUUID();
  const secondTurn = randomUUID();
  insertTurn.run(firstTurn, jira.id, at(26), at(20));
  insertTurn.run(secondTurn, jira.id, at(8), at(6));

  const insertMessage = database.prepare(
    "INSERT INTO messages (id, agent_id, role, content, created_at, turn_id) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const messages = [
    [firstTurn, "user", "Draft a concise standup update and call out the release risk.", at(26)],
    [firstTurn, "tool", "browser_navigate: url: https://fid.atlassian.net/jira/your-work\ntitle: Jira — Your work", at(24)],
    [firstTurn, "tool", "browser_snapshot: Read 7 assigned issues\n(+14 more lines)", at(23)],
    [firstTurn, "tool", "browser_click: clicked text=Assigned to me on https://fid.atlassian.net/jira/your-work", at(22)],
    [
      firstTurn,
      "assistant",
      "Morning check is done. Three things need your attention before standup:\n\n- **FID-482 · Checkout retry loop** — QA flagged a duplicate charge when payments time out. This is the release blocker.\n- **FID-471 · Export job stuck** — Code-complete, waiting on a second approval.\n- **FID-456 · SSO group mapping** — Blocks onboarding for two new hires.\n\nToday: verify the retry fix with QA and unblock the export approval.",
      at(20),
    ],
    [secondTurn, "user", "Draft a short update for standup.", at(8)],
    [
      secondTurn,
      "assistant",
      "**Standup update**\n\n- Two release blockers are open: **FID-482** and **FID-456**.\n- **FID-471** is code-complete and waiting on a second approval.\n- Today: take ownership of FID-482 and confirm the retry fix with QA.\n\n> Release risk: High. **FID-482** needs verification today.",
      at(6),
    ],
  ];
  for (const [turnId, role, content, createdAt] of messages) {
    insertMessage.run(randomUUID(), jira.id, role, content, createdAt, turnId);
  }

  const insertRoutine = database.prepare(
    `INSERT INTO routines (
      id, agent_id, name, prompt, cron, enabled, notify, read_only, last_run_at, next_run_at, last_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tomorrow = new Date(now + 24 * 60 * 60_000);
  tomorrow.setHours(9, 0, 0, 0);
  const nextFriday = new Date(now);
  const fridayDelta = (5 - nextFriday.getDay() + 7) % 7 || 7;
  nextFriday.setDate(nextFriday.getDate() + fridayDelta);
  nextFriday.setHours(16, 0, 0, 0);
  const gitNext = new Date(now + 24 * 60 * 60_000);
  gitNext.setHours(10, 0, 0, 0);
  const onceAt = new Date(now + 24 * 60 * 60_000);
  onceAt.setHours(16, 30, 0, 0);
  const createdAt = new Date(now - 7 * 24 * 60 * 60_000).toISOString();
  const updatedAt = new Date(now).toISOString();

  const insertFact = database.prepare(
    "INSERT INTO agent_facts (id, agent_id, content, source, enabled, created_at, updated_at) VALUES (?, ?, ?, 'user', 1, ?, ?)",
  );
  insertFact.run(
    randomUUID(),
    jira.id,
    "The release branch is main; publish release notes under docs/releases.",
    createdAt,
    updatedAt,
  );
  insertFact.run(
    randomUUID(),
    null,
    "Use the ticket key in every commit message.",
    createdAt,
    updatedAt,
  );

  const insertOnce = database.prepare(
    `INSERT INTO routines (
      id, agent_id, name, prompt, cron, once, run_at, enabled, notify, read_only, last_run_at, next_run_at, last_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 1, 1, 0, NULL, ?, NULL, ?, ?)`,
  );
  insertOnce.run(
    randomUUID(),
    jira.id,
    "Afternoon reminder",
    "Run the release checks and report the result.",
    `${onceAt.getMinutes()} ${onceAt.getHours()} ${onceAt.getDate()} ${onceAt.getMonth() + 1} *`,
    onceAt.toISOString(),
    onceAt.toISOString(),
    createdAt,
    updatedAt,
  );

  const morningId = randomUUID();
  insertRoutine.run(
    morningId,
    jira.id,
    "Morning ticket sweep",
    "Check my assigned Jira tickets and summarize the top three.",
    "0 9 * * 1-5",
    1,
    1,
    1,
    at(24 * 60),
    tomorrow.toISOString(),
    "ok",
    createdAt,
    updatedAt,
  );
  database
    .prepare(
      `INSERT INTO routine_runs (
        id, routine_id, agent_id, trigger, read_only, status, started_at, ended_at, turn_id, output, error
      ) VALUES (?, ?, ?, 'schedule', 1, 'ok', ?, ?, NULL, ?, NULL)`,
    )
    .run(
      randomUUID(),
      morningId,
      jira.id,
      at(24 * 60 + 2),
      at(24 * 60 + 1),
      "Three tickets are waiting.",
    );
  insertRoutine.run(
    randomUUID(),
    jira.id,
    "Friday release notes",
    "Draft release notes from the changes merged this week.",
    "0 16 * * 5",
    0,
    1,
    0,
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
    0,
    at(24 * 60),
    gitNext.toISOString(),
    "ok",
    createdAt,
    updatedAt,
  );

  const demoWorkspace = "D:\\Projects\\my-app";
  database.prepare("UPDATE agents SET workspace_dir = ? WHERE id = ?").run(demoWorkspace, git.id);
  database
    .prepare("UPDATE agents SET updated_at = ? WHERE id = ?")
    .run(new Date(now - 30 * 24 * 60 * 60_000).toISOString(), git.id);

  const demoId = randomUUID();
  database
    .prepare(
      `INSERT INTO agents (
        id, name, description, system_prompt, workspace_dir, model, tool_profile, read_only,
        memory_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      demoId,
      "Code Assistant",
      "Ask about this repository",
      "You are a helpful local assistant. Answer questions about this repository.",
      demoWorkspace,
      "auto",
      "developer",
      1,
      1,
      createdAt,
      updatedAt,
    );

  const mapText = [
    "## Overview",
    "A small desktop app with a renderer, a main process, and a preload bridge. The renderer owns the conversation UI; the main process owns tools, approvals, and persistence.",
    "",
    "## Components",
    "| Component | Responsibility | Key files | Depends on |",
    "| --- | --- | --- | --- |",
    "| Renderer | Conversation, composer, and project map | `src/renderer/App.tsx:18` | Preload bridge |",
    "| Main | Turns, tools, and SQLite | `src/main/index.ts:24` | Workspace |",
    "| Preload | Typed IPC bridge | `src/preload/index.ts:16` | Main IPC |",
    "",
    "## Key flow",
    "```mermaid",
    "sequenceDiagram",
    "  participant U as User",
    "  participant R as Renderer",
    "  participant M as Main",
    "  U->>R: Send a message",
    "  R->>M: chat.send",
    "  M-->>R: stream and tool events",
    "  R-->>U: Answer",
    "```",
    "",
    "## Suggested reading order",
    "1. `src/main/index.ts:1` — process startup and services.",
    "2. `src/preload/index.ts:16` — the IPC surface.",
    "3. `src/renderer/App.tsx:29` — selected agent and dialogs.",
    "4. `src/main/chat/runner.ts:261` — the turn lifecycle.",
    "5. `src/main/db/index.ts:204` — persisted state and migrations.",
    "",
    "## Risks and unknowns",
    "- The preload channel list is copied by hand; a missing name fails only at runtime.",
    "- The workspace brief is cached by `HEAD`; uncommitted edits can make it stale.",
  ].join("\n");
  database
    .prepare(
      `INSERT INTO workspace_maps (workspace_dir, cache_key, text, generated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(demoWorkspace, "no-git", mapText, updatedAt);
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

async function saveRegion(page, selectors, name) {
  const boxes = (
    await Promise.all(selectors.map((selector) => page.locator(selector).first().boundingBox()))
  ).filter(Boolean);
  if (boxes.length === 0) throw new Error(`No visible element for ${selectors.join(", ")}`);
  const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - 8);
  const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - 8);
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + 8;
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + 8;
  const file = path.join(outDir, name);
  await page.screenshot({
    path: file,
    animations: "disabled",
    clip: { x: left, y: top, width: right - left, height: bottom - top },
  });
  const bytes = fs.statSync(file).size;
  console.log(`Wrote ${name} (${Math.round(bytes / 1024)} KB)`);
}

function writeDemoSkill(id, name, description, version, body) {
  const dir = path.join(userData, "skills", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\nversion: ${version}\n---\n\n${body}\n`,
  );
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
    await sleep(200);
  }
  console.log(log);
  throw new Error("Vite did not start on 5173");
}

async function viteRunning() {
  try {
    const response = await fetch("http://127.0.0.1:5173", { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
