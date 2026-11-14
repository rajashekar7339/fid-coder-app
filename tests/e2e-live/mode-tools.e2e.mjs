// Live end-to-end test for the Tools x Mode model.
//
// Usage:
//   npm run test:modes
//   FID_SKIP_TURNS=1 npm run test:modes   # launch/UI and matrix checks only
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// The test launches its own Electron instance with a temporary userData
// directory and a throwaway dummy repo under os.tmpdir(). It never uses the
// Fid Coder source tree as the agent workspace.
// Screenshots and logs stay under the printed ARTIFACTS directory.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-modes-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Mode Tools Agent";
const skipTurns = process.env.FID_SKIP_TURNS === "1";
const clean = process.env.FID_CLEAN === "1";

const results = [];
let vite = null;
let app = null;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function git(args) {
  execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd: workspace,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "E2E",
      GIT_AUTHOR_EMAIL: "e2e@example.com",
      GIT_COMMITTER_NAME: "E2E",
      GIT_COMMITTER_EMAIL: "e2e@example.com",
    },
    stdio: "ignore",
  });
}

function assertDummyRepo() {
  const tempRoot = path.resolve(os.tmpdir());
  const repo = path.resolve(workspace);
  const liveRepo = path.resolve(appDir);
  if (!repo.startsWith(`${tempRoot}${path.sep}`)) {
    throw new Error(`The test workspace must stay under ${tempRoot}`);
  }
  if (repo === liveRepo || repo.startsWith(`${liveRepo}${path.sep}`)) {
    throw new Error("The test workspace must not be the live app repo");
  }
}

function prepare() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  assertDummyRepo();
  fs.writeFileSync(path.join(workspace, "demo.ts"), 'export const greeting = "hello";\n', "utf8");
  fs.writeFileSync(path.join(workspace, "locked.ts"), 'export const guard = "locked";\n', "utf8");
  fs.writeFileSync(
    path.join(workspace, "package.json"),
    ['{', '  "name": "mode-tools-fixture",', '  "version": "1.0.0",', '  "private": true', "}", ""].join("\n"),
    "utf8",
  );
  git(["init"]);
  git(["add", "."]);
  git(["commit", "-m", "baseline dummy repo"]);
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
  const before = await page.locator("article.message .message-body").count();
  await page.locator(".composer-input").fill(prompt);
  await page.locator(".composer-input").press("Enter");
  await page.waitForFunction(
    (count) =>
      Boolean(document.querySelector('button[aria-label="Stop generating"]')) ||
      document.querySelectorAll("article.message .message-body").length > count ||
      Boolean(document.querySelector(".chat-error")),
    before,
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

async function agentByName(page, name) {
  return page.evaluate(
    (target) => window.fid.agents.list().then((list) => list.find((item) => item.name === target) ?? null),
    name,
  );
}

async function preview(page, agentId) {
  return page.evaluate((id) => window.fid.context.preview(id), agentId);
}

function hasTools(view, names) {
  return names.every((name) => view.tools.includes(name));
}

function lacksTools(view, names) {
  return names.every((name) => !view.tools.includes(name));
}

async function waitForFile(file, needle, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (fs.readFileSync(file, "utf8").includes(needle)) return true;
    } catch {
      // The file may be mid-write.
    }
    await sleep(250);
  }
  return false;
}

async function changes(page, agentId) {
  return page.evaluate((id) => window.fid.changes.list(id), agentId);
}

async function toolCalls(page, agentId) {
  return page.evaluate(
    async (id) => {
      const messages = await window.fid.messages.list(id);
      return messages
        .filter((message) => message.role === "tool")
        .map((message) => message.content)
        .filter((content) => /apply_patch|file_write|shell_run/.test(content));
    },
    agentId,
  );
}

async function editAgent(page, name, { toolProfile, readOnly }) {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Edit agent" }).click();
  await page.waitForSelector(".agent-modal", { timeout: 10_000 });
  const beforeMode = await page.locator(".agent-mode-switch button[aria-pressed='true']").innerText();
  await page.locator("#agent-tools").selectOption(toolProfile);
  await page
    .locator(".agent-mode-switch")
    .getByRole("button", { name: readOnly ? "Ask mode" : "Agent mode", exact: true })
    .click();
  return beforeMode;
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

    // ---- Create an agent through the UI; Tools and Mode are the only choices ----
    await page.locator(".new-agent-row").click();
    await page.waitForSelector(".agent-modal", { timeout: 10_000 });
    check("the editor has no agent templates", (await page.locator(".agent-templates").count()) === 0);
    check(
      "the new agent defaults to Ask mode",
      (await page.locator(".agent-mode-switch button.is-active").innerText()) === "Ask mode",
    );
    check("the new agent defaults to All tools", (await page.locator("#agent-tools").inputValue()) === "all");

    await page.getByLabel("Name", { exact: true }).fill(agentName);
    await page.getByLabel("Workspace", { exact: true }).fill(workspace);
    await page.locator(".agent-form-scroll").evaluate((element) => {
      element.scrollTop = 0;
    });
    await shot(page, "01-new-agent");
    await page.locator(".agent-mode-switch").scrollIntoViewIfNeeded();
    await shot(page, "01b-new-agent-mode");
    await page.getByRole("button", { name: "Create agent" }).click();
    await page.waitForSelector(".agent-modal", { state: "detached", timeout: 20_000 });
    await page.waitForFunction(
      (name) => document.querySelector(".chat-title h1")?.textContent?.trim() === name,
      agentName,
      { timeout: 15_000 },
    );

    const created = await agentByName(page, agentName);
    if (!created) throw new Error("The test agent was not created");
    check(
      "the new agent saves Ask mode and All tools",
      created.readOnly === true && created.toolProfile === "all",
      `readOnly=${created.readOnly} profile=${created.toolProfile}`,
    );
    check(
      "the default instructions contain no permission rule",
      /helpful local assistant/i.test(created.systemPrompt) &&
        !/do not edit/i.test(created.systemPrompt) &&
        !/switch to code/i.test(created.systemPrompt),
      created.systemPrompt,
    );

    const defaultAsk = await preview(page, created.id);
    check(
      "Ask mode registers the read-only All tools profile",
      hasTools(defaultAsk, ["file_read", "read_many", "search_text", "git_status", "browser_navigate", "browser_snapshot", "explore_code"]) &&
        lacksTools(defaultAsk, ["file_write", "apply_patch", "shell_run", "browser_click", "browser_type"]),
      defaultAsk.tools.join(", "),
    );
    check("the Ask mode hint is in the prompt", /You are in Ask mode/.test(defaultAsk.systemMessage));

    // ---- Change Mode to Agent mode through the UI ----
    const editorModeBefore = await editAgent(page, agentName, { toolProfile: "all", readOnly: false });
    check("the editor shows the saved Ask mode before the change", editorModeBefore === "Ask mode", editorModeBefore);
    check(
      "the editor selects Agent mode",
      (await page.locator(".agent-mode-switch button[aria-pressed='true']").innerText()) === "Agent mode",
    );
    await page.locator(".agent-mode-switch").scrollIntoViewIfNeeded();
    await shot(page, "02-agent-mode-editor");
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForSelector(".agent-modal", { state: "detached", timeout: 20_000 });

    const updated = await agentByName(page, agentName);
    check(
      "the editor saves All tools and Agent mode",
      updated.readOnly === false && updated.toolProfile === "all",
      `readOnly=${updated.readOnly} profile=${updated.toolProfile}`,
    );
    const agentView = await preview(page, updated.id);
    check(
      "Agent mode registers the full All tools profile",
      hasTools(agentView, ["file_write", "apply_patch", "shell_run", "browser_navigate", "browser_click", "browser_type"]),
      agentView.tools.join(", "),
    );
    check(
      "Agent mode has no read-only permission rule in the prompt",
      !/You are in Ask mode/.test(agentView.systemMessage) &&
        !/Do not edit files/i.test(agentView.systemMessage) &&
        !/switch to Code/i.test(agentView.systemMessage),
    );

    // ---- Matrix: every Tools x Mode combination ----
    const matrix = await page.evaluate(async (folder) => {
      const base = {
        description: "",
        systemPrompt: "Matrix check.",
        workspaceDir: folder,
        model: "auto",
        memoryEnabled: false,
      };
      const make = (name, toolProfile, readOnly, workspaceDir = folder) =>
        window.fid.agents.create({ ...base, name, workspaceDir, toolProfile, readOnly });
      const allAgent = await make("Matrix all agent", "all", false);
      const allAsk = await make("Matrix all ask", "all", true);
      const browserAgent = await make("Matrix browser agent", "browser", false, null);
      const browserAsk = await make("Matrix browser ask", "browser", true, null);
      const developerAgent = await make("Matrix developer agent", "developer", false);
      return {
        allAgent: allAgent.id,
        allAsk: allAsk.id,
        browserAgent: browserAgent.id,
        browserAsk: browserAsk.id,
        developerAgent: developerAgent.id,
      };
    }, workspace);

    const allAgentView = await preview(page, matrix.allAgent);
    check(
      "Matrix: All tools + Agent mode is full access",
      hasTools(allAgentView, ["file_write", "apply_patch", "shell_run", "browser_navigate", "browser_click", "browser_type"]),
    );
    const allAskView = await preview(page, matrix.allAsk);
    check(
      "Matrix: All tools + Ask mode is read-only",
      hasTools(allAskView, ["file_read", "search_text", "browser_navigate", "browser_snapshot"]) &&
        lacksTools(allAskView, ["file_write", "apply_patch", "shell_run", "browser_click", "browser_type"]),
    );
    const browserAgentView = await preview(page, matrix.browserAgent);
    check(
      "Matrix: Browser + Agent mode can click and type",
      hasTools(browserAgentView, ["browser_navigate", "browser_snapshot", "browser_click", "browser_type"]) &&
        lacksTools(browserAgentView, ["file_write", "shell_run"]),
    );
    const browserAskView = await preview(page, matrix.browserAsk);
    check(
      "Matrix: Browser + Ask mode only navigates and snapshots",
      hasTools(browserAskView, ["browser_navigate", "browser_snapshot"]) &&
        lacksTools(browserAskView, ["browser_click", "browser_type", "file_write", "shell_run"]),
    );
    const developerAgentView = await preview(page, matrix.developerAgent);
    check(
      "Matrix: Developer + Agent mode writes and runs shell",
      hasTools(developerAgentView, ["file_write", "apply_patch", "shell_run"]) &&
        lacksTools(developerAgentView, ["browser_navigate", "browser_click"]),
    );
    check(
      "Matrix: every Ask mode has the read-only hint",
      [allAskView, browserAskView].every((view) => /You are in Ask mode/.test(view.systemMessage)),
    );
    check(
      "Matrix: no Agent mode has the read-only hint",
      [allAgentView, browserAgentView, developerAgentView].every(
        (view) => !/You are in Ask mode/.test(view.systemMessage),
      ),
    );

    await page.evaluate(
      (ids) => Promise.all(ids.map((id) => window.fid.agents.delete(id))),
      Object.values(matrix),
    );

    if (skipTurns) {
      console.log("FID_SKIP_TURNS=1: skipping Copilot turns");
      return;
    }

    // ---- Live turn: Agent mode can edit ----
    await sendAndWait(
      page,
      [
        "Read demo.ts with file_read.",
        'Then use apply_patch to change "hello" to "edited".',
        "Do not use shell_run. Reply in one short sentence.",
      ].join("\n"),
    );
    const edited = await waitForFile(path.join(workspace, "demo.ts"), "edited");
    check("Agent mode changed the file", edited, fs.readFileSync(path.join(workspace, "demo.ts"), "utf8").trim());
    const editReply = await lastAssistantText(page);
    check("Agent mode returned a reply", editReply.trim().length > 0, editReply.replace(/\s+/g, " ").slice(0, 140));
    await page.waitForSelector(".edited-files-card", { timeout: 20_000 });
    check("Agent mode recorded a change set", (await changes(page, updated.id)).length >= 1);
    await shot(page, "03-live-edit");

    const changesBeforeAsk = (await changes(page, updated.id)).length;
    const toolsBeforeAsk = (await toolCalls(page, updated.id)).length;

    // ---- Switch back to Ask mode from the composer ----
    await page.locator(".mode-switch").getByRole("button", { name: "Ask mode", exact: true }).click();
    await page.waitForFunction(
      (name) =>
        window.fid.agents.list().then((list) => list.find((item) => item.name === name)?.readOnly === true),
      agentName,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () => document.querySelector(".mode-switch button.is-active")?.textContent?.trim() === "Ask mode",
      null,
      { timeout: 10_000 },
    );
    check("the composer saves Ask mode", (await page.locator(".mode-switch button.is-active").innerText()) === "Ask mode");

    const askView = await preview(page, updated.id);
    check(
      "Ask mode filters All tools down to read-only tools",
      hasTools(askView, ["file_read", "search_text", "git_status", "browser_navigate", "browser_snapshot"]) &&
        lacksTools(askView, ["file_write", "apply_patch", "shell_run", "browser_click", "browser_type"]),
      askView.tools.join(", "),
    );
    check("Ask mode adds the read-only hint", /You are in Ask mode/.test(askView.systemMessage));
    await shot(page, "04-ask-mode-switch");

    // ---- Live turn: Ask mode must not act ----
    await sendAndWait(
      page,
      [
        "Change \"locked\" to \"unlocked\" in locked.ts with apply_patch.",
        "Then use shell_run to create should-not-exist.txt.",
        "Reply in one short sentence.",
      ].join("\n"),
    );
    const locked = fs.readFileSync(path.join(workspace, "locked.ts"), "utf8");
    check("Ask mode left locked.ts unchanged", locked.includes("locked") && !locked.includes("unlocked"), locked.trim());
    check("Ask mode did not create a shell file", !fs.existsSync(path.join(workspace, "should-not-exist.txt")));
    const changesAfterAsk = (await changes(page, updated.id)).length;
    check(
      "Ask mode recorded no change set",
      changesAfterAsk === changesBeforeAsk,
      `${changesBeforeAsk} -> ${changesAfterAsk}`,
    );
    const toolsAfterAsk = (await toolCalls(page, updated.id)).length;
    check(
      "Ask mode called no apply_patch, file_write, or shell_run",
      toolsAfterAsk === toolsBeforeAsk,
      `${toolsBeforeAsk} -> ${toolsAfterAsk} tool calls`,
    );
    const askReply = await lastAssistantText(page);
    check(
      "Ask mode explained the restriction",
      /agent mode|read-only|cannot|can't|unable|not able/i.test(askReply),
      askReply.replace(/\s+/g, " ").slice(0, 180),
    );
    await shot(page, "05-live-ask-refusal");
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
  console.error("MODE TOOLS E2E FAILED:", error);
  process.exitCode = 1;
});
