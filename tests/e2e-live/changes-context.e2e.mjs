// Live end-to-end test for turn changes/revert, workspace rules,
// and the context inspector.
//
// Usage:
//   npm run test:features            # four real Copilot turns
//   FID_SKIP_TURNS=1 npm run test:features   # launch/UI setup only
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// The test launches its own Electron instance with a temporary userData
// directory, so it does not touch the app you are using. It reuses Vite on
// port 5173 if one is running; otherwise it starts and stops its own.
// The agent workspace is a throwaway dummy repo under os.tmpdir(); no file
// from the Fid Coder source tree is used as workspace content.
// Screenshots and logs stay under the printed ARTIFACTS directory.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-features-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const uploadFile = path.join(root, "brief.txt");
const shots = path.join(root, "shots");
const agentName = "Live Test Agent";
const skipTurns = process.env.FID_SKIP_TURNS === "1";
const runReview = process.env.FID_RUN_REVIEW === "1";
const runDiagram = process.env.FID_RUN_DIAGRAM === "1";
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
  assertDummyRepo();
  fs.mkdirSync(path.join(workspace, "src", "main"), { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(path.join(workspace, "demo.ts"), "export const greeting = 'hello';\n", "utf8");
  fs.writeFileSync(
    path.join(workspace, "package.json"),
    [
      "{",
      '  "name": "dummy-repo-fixture",',
      '  "version": "1.0.0",',
      '  "private": true,',
      '  "main": "dist/dummy-app.js",',
      '  "scripts": {',
      '    "clean": "rm -rf dist",',
      '    "build:node": "tsc -p tsconfig.main.json",',
      '    "dev": "vite",',
      '    "build": "npm run build:node && vite build",',
      '    "typecheck": "tsc --noEmit",',
      '    "test": "node --test",',
      '    "test:unit": "node --test tests/unit",',
      '    "test:integration": "node --test tests/integration",',
      '    "test:changes": "electron tests/changes.mjs",',
      '    "test:features": "electron tests/features.mjs",',
      '    "start": "electron .",',
      '    "dist:win": "electron-builder --win portable",',
      '    "lint": "eslint .",',
      '    "format": "prettier --write .",',
      '    "seed": "node scripts/seed.mjs",',
      '    "clean:all": "npm run clean && rm -rf release",',
      '    "check": "npm run typecheck && npm test",',
      '    "ci": "npm run check && npm run build",',
      '    "watch": "tsc --watch",',
      '    "serve": "vite preview",',
      '    "prepare": "husky",',
      '    "postinstall": "node scripts/postinstall.mjs"',
      "  },",
      '  "dependencies": {}',
      "}",
    ].join("\n") + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(workspace, "src", "main", "index.ts"),
    [
      'import fs from "node:fs";',
      'import os from "node:os";',
      'import path from "node:path";',
      'import { app } from "electron";',
      "",
      'const APP_NAME = "dummy-app";',
      "",
      "function defaultUserData(): string {",
      '  return path.join(os.homedir(), ".dummy_app");',
      "}",
      "",
      "function start(): void {",
      "  app.setName(APP_NAME);",
      "  const userData = defaultUserData();",
      "  fs.mkdirSync(userData, { recursive: true });",
      '  app.setPath("userData", userData);',
      "  const override = process.env.FID_CODER_USER_DATA;",
      "  if (override) {",
      '    app.setPath("userData", override);',
      "  }",
      "  app.whenReady().then(() => {",
      "    createWindow();",
      "  });",
      "}",
      "",
      "start();",
    ].join("\n") + "\n",
    "utf8",
  );
  fs.writeFileSync(uploadFile, "PINEAPPLE_MARKER\n", "utf8");
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

async function sendLiveAttachments(page, prompt, attachments) {
  return page.evaluate(
    async ({ name, prompt: text, refs }) => {
      const agents = await window.fid.agents.list();
      const target = agents.find((item) => item.name === name);
      if (!target) return { error: "agent missing", attachments: 0, ranges: "", assistant: "" };
      try {
        await window.fid.chat.send(target.id, text, refs);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : String(error),
          attachments: 0,
          ranges: "",
          assistant: "",
        };
      }
      const messages = await window.fid.messages.list(target.id);
      const user = [...messages].reverse().find((item) => item.role === "user");
      const assistant = [...messages].reverse().find((item) => item.role === "assistant");
      return {
        error: "",
        attachments: user?.attachments?.length ?? 0,
        ranges: (user?.attachments ?? [])
          .map((item) => `${item.path}:${item.startLine ?? 0}-${item.endLine ?? 0}`)
          .join(", "),
        assistant: assistant?.content ?? "",
      };
    },
    { name: agentName, prompt, refs: attachments },
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
          systemPrompt: "You are a careful coding agent. Use tools when asked. Keep replies short.",
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
      "an empty workspace offers the browse button without a changes card",
      (await page.locator(".edited-files-card").count()) === 0 &&
        (await page.locator(".header-workspace").count()) === 1,
    );

    if (skipTurns) {
      console.log("FID_SKIP_TURNS=1: skipping Copilot turns");
      return;
    }

    // ---- Turn 1: file changes ----
    await sendAndWait(
      page,
      [
        "Steps:",
        "1. Read demo.ts with file_read.",
        "2. Use apply_patch to change \"export const greeting = 'hello';\" to \"export const greeting = 'hi';\".",
        "3. Use file_write to create notes.md containing exactly: first note",
        "Do not use shell_run. Keep the final reply to one short sentence.",
      ].join("\n"),
    );

    const reply1 = await lastAssistantText(page);
    check("turn 1 produced an assistant reply", reply1.trim().length > 0, reply1.replace(/\s+/g, " ").slice(0, 120));
    await page.waitForSelector(".token-usage", { timeout: 15_000 });
    const usageText = await page.locator(".token-usage").last().innerText();
    check(
      "reply shows token usage",
      /\d[\d,]* tokens/.test(usageText),
      usageText.replace(/\s+/g, " ").slice(0, 120),
    );

    if (runReview) {
      await sendAndWait(page, "/review ");
      const review = await lastAssistantText(page);
      const reviewSteps = await page.locator(".tool-step code", { hasText: "/review" }).count();
      check(
        "review command returned a report",
        reviewSteps > 0 && /verdict|what this change does|looks good|must fix/i.test(review),
        `${reviewSteps} /review step(s); ${review.replace(/\s+/g, " ").slice(0, 140)}`,
      );
    }

    if (runDiagram) {
      await sendAndWait(
        page,
        "Draw a two-step login flow as one mermaid flowchart code block. Do not write anything outside the code block.",
      );
      await page.waitForSelector(".is-mermaid .mermaid-canvas svg", { timeout: 30_000 });
      await page.getByRole("button", { name: "Copy diagram as image" }).last().click();
      const copyState = await page
        .waitForFunction(
          () => {
            const buttons = [...document.querySelectorAll('button[aria-label="Copy diagram as image"]')];
            const last = buttons[buttons.length - 1];
            const text = last?.textContent ?? "";
            return /Copied|Copy failed/.test(text) ? text : null;
          },
          { timeout: 15_000 },
        )
        .then((handle) => handle.jsonValue());
      check("diagram copy image responds", /Copied|Copy failed/.test(copyState), copyState);
    }

    const demoAfterTurn = fs.readFileSync(path.join(workspace, "demo.ts"), "utf8");
    const notesPath = path.join(workspace, "notes.md");
    check("apply_patch changed demo.ts", demoAfterTurn.includes("'hi'"), demoAfterTurn.trim());
    check(
      "file_write created notes.md",
      fs.existsSync(notesPath),
      fs.existsSync(notesPath) ? fs.readFileSync(notesPath, "utf8").trim() : "missing",
    );

    await page.waitForSelector(".edited-files-card", { timeout: 20_000 });
    const cardText = await page.locator(".edited-files-card").last().innerText();
    check(
      "the thread card lists both files",
      /Edited 2 files/.test(cardText) && /demo\.ts/.test(cardText) && /notes\.md/.test(cardText),
      cardText.replace(/\s+/g, " ").slice(0, 200),
    );
    await page.waitForSelector(".header-workspace", { timeout: 15_000 });
    await page.locator(".header-workspace").click();
    await page.waitForSelector(".changes-panel", { timeout: 15_000 });
    check("opening changes closes the desk", (await page.locator(".agent-desk").count()) === 0);
    await page.waitForFunction(
      () => document.querySelectorAll(".changes-tree-file").length === 2,
      null,
      { timeout: 20_000 },
    );
    await page.waitForSelector(".changes-diff-scroll .diff-line", { timeout: 15_000 });
    await page.waitForTimeout(250);
    await shot(page, "03-changes");

    const treeText = await page.locator(".changes-tree-list").innerText();
    check(
      "the changed-file tree lists both files",
      /demo\.ts/.test(treeText) && /notes\.md/.test(treeText),
      treeText.replace(/\s+/g, " ").slice(0, 160),
    );
    await page.locator(".changes-tree-file", { hasText: "demo.ts" }).click();
    await page.waitForFunction(
      () => /demo\.ts/.test(document.querySelector(".changes-diff-name")?.textContent ?? ""),
      null,
      { timeout: 10_000 },
    );
    const diffText = await page.locator(".changes-diff-scroll").innerText();
    check(
      "the diff shows the old and new line",
      /hello/.test(diffText) && /hi/.test(diffText),
      diffText.replace(/\s+/g, " ").slice(0, 160),
    );
    await page.waitForTimeout(250);
    await shot(page, "04-diff");

    await page.locator(".changes-diff-foot .btn-danger-outline").click();
    await page.waitForSelector(".confirm-modal", { timeout: 10_000 });
    await page.waitForTimeout(250);
    await shot(page, "05-revert-confirm");
    await page.locator(".confirm-modal .btn-destructive").click();
    await page.waitForSelector(".confirm-modal", { state: "detached", timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelectorAll(".changes-tree-file").length === 1,
      null,
      { timeout: 20_000 },
    );
    const demoRestored = fs.readFileSync(path.join(workspace, "demo.ts"), "utf8");
    check(
      "revert file restored demo.ts",
      demoRestored.includes("'hello'") && !demoRestored.includes("'hi'"),
      demoRestored.trim(),
    );
    check("revert file left notes.md alone", fs.existsSync(notesPath));

    await page.locator(".changes-undo").click();
    await page.waitForSelector(".confirm-modal", { timeout: 10_000 });
    await page.locator(".confirm-modal .btn-destructive").click();
    await page.waitForSelector(".changes-empty", { timeout: 20_000 });
    check("revert turn removed created notes.md", !fs.existsSync(notesPath));
    await page.waitForTimeout(250);
    await shot(page, "06-changes-empty");

    await page.locator('.changes-panel button[aria-label="Close changes"]').click();
    await page.waitForSelector(".changes-panel", { state: "detached", timeout: 10_000 });
    await page.locator('button[aria-label="Show agent desk"]').click();
    await page.waitForSelector(".agent-desk", { timeout: 10_000 });

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

    await sendAndWait(page, "What is 2 + 2? Answer in one short sentence.");
    const reply2 = await lastAssistantText(page);
    check("rules were applied to the turn", /banana/i.test(reply2), reply2.replace(/\s+/g, " ").slice(0, 160));

    console.log("watch: sending a line selection (demo.ts:1) and an upload (brief.txt) to Copilot");
    await page.waitForTimeout(1500);
    const attachmentSmoke = await sendLiveAttachments(
      page,
      "Reply with the exact code on the attached selection and the exact word in the attached file. Keep it to one line.",
      [
        { kind: "selection", path: "demo.ts", name: "demo.ts", startLine: 1, endLine: 1 },
        { kind: "upload", path: uploadFile, name: "brief.txt" },
      ],
    );
    check(
      "selection and upload attachments reach the live turn",
      !attachmentSmoke.error &&
        attachmentSmoke.attachments === 2 &&
        /hello/i.test(attachmentSmoke.assistant) &&
        /PINEAPPLE_MARKER/.test(attachmentSmoke.assistant),
      attachmentSmoke.error || attachmentSmoke.assistant.replace(/\s+/g, " ").slice(0, 160),
    );
    await page.waitForTimeout(2500);
    await shot(page, "08-attachments");

    console.log("watch: pinning package.json:8-28 and src/main/index.ts:11-25 from the workspace panel");
    await page.locator(".header-workspace").click();
    await page.waitForSelector(".changes-panel", { timeout: 15_000 });

    const packageRow = page.locator(".workspace-tree-file", { hasText: "package.json" }).first();
    await packageRow.waitFor({ timeout: 15_000 });
    await packageRow.click();
    await page.waitForSelector('.citation-line[data-line="8"]', { timeout: 15_000 });
    await page.locator('.citation-line[data-line="8"] .citation-line-number').click();
    await page.locator('.citation-line[data-line="28"] .citation-line-number').click({ modifiers: ["Shift"] });
    await page.waitForFunction(
      () =>
        /package\.json:8–28/.test(
          document.querySelector(".composer-attachment.is-active-context")?.textContent ?? "",
        ),
      null,
      { timeout: 10_000 },
    );
    await page.keyboard.press("Control+Shift+L");
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".composer-attachment:not(.is-active-context)")].some((item) =>
          /package\.json:8–28/.test(item.textContent ?? ""),
        ),
      null,
      { timeout: 10_000 },
    );

    const srcFolder = page.locator(".workspace-tree-folder", { hasText: "src" }).first();
    await srcFolder.click();
    const mainFolder = page.locator(".workspace-tree-folder", { hasText: "main" }).first();
    await mainFolder.waitFor({ timeout: 15_000 });
    await mainFolder.click();
    const indexRow = page.locator(".workspace-tree-file", { hasText: "index.ts" }).first();
    await indexRow.waitFor({ timeout: 15_000 });
    await indexRow.click();
    await page.waitForSelector('.citation-line[data-line="11"]', { timeout: 15_000 });
    await page.locator('.citation-line[data-line="11"] .citation-line-number').click();
    await page.locator('.citation-line[data-line="25"] .citation-line-number').click({ modifiers: ["Shift"] });
    await page.waitForFunction(
      () =>
        /index\.ts:11–25/.test(
          document.querySelector(".composer-attachment.is-active-context")?.textContent ?? "",
        ),
      null,
      { timeout: 10_000 },
    );
    await page.keyboard.press("Control+Shift+L");
    await page.waitForFunction(
      () => document.querySelectorAll(".composer-attachment:not(.is-active-context)").length === 2,
      null,
      { timeout: 10_000 },
    );
    const pinnedChips = await page
      .locator(".composer-attachment:not(.is-active-context)")
      .allInnerTexts();
    check(
      "two line ranges are pinned in the composer",
      pinnedChips.length === 2 &&
        /package\.json:8–28/.test(pinnedChips.join(" ")) &&
        /index\.ts:11–25/.test(pinnedChips.join(" ")),
      pinnedChips.join(", "),
    );
    await page.waitForTimeout(250);
    await shot(page, "08b-two-range-pinned");

    await page.getByRole("button", { name: "Close changes" }).click();
    await page.waitForSelector(".changes-panel", { state: "detached", timeout: 10_000 });
    await sendAndWait(
      page,
      "List the code from both highlighted ranges. Include one package.json script and the startup line that sets app userData.",
    );
    const rangeReply = await lastAssistantText(page);
    check(
      "the two pinned ranges reach the live agent",
      /(scripts|build:node|postinstall|"start"|"dev"|"build"|electron)/i.test(rangeReply) &&
        /(user.?data|startup|main.process|whenReady|setName|initializ)/i.test(rangeReply),
      rangeReply.replace(/\s+/g, " ").slice(0, 220),
    );
    const lastUser = page.locator(".user-message").last();
    const lastUserChips = await lastUser.locator(".user-attachment").allInnerTexts();
    check(
      "the two range chips appear on the live user message",
      lastUserChips.length === 2 &&
        /package\.json:8–28/.test(lastUserChips.join(" ")) &&
        /index\.ts:11–25/.test(lastUserChips.join(" ")),
      lastUserChips.join(", "),
    );
    await lastUser.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await shot(page, "08b-two-range-chips");

    await page.locator('button[aria-label="Show agent desk"]').click();
    await page.waitForSelector(".agent-desk", { timeout: 10_000 });
    await page.locator('.agent-desk button:has-text("Context")').click();
    await page.waitForSelector(".context-modal", { timeout: 15_000 });
    await page.waitForSelector(".context-modal .context-block", { timeout: 30_000 });
    await page.waitForTimeout(400);
    const contextText = await page.locator(".context-modal .context-body").innerText();
    check("context shows project rules", /Project rules/.test(contextText) && /BANANA/.test(contextText));
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
