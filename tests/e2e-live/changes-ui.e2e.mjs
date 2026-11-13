// Deterministic Electron UI test for the changes card, panel, and citation bridge.
//
// Usage:
//   npm run test:changes
//
// No Copilot turn is needed. The test seeds a temporary database, checkpoint
// blobs, and a workspace, then launches the app against them.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-changes-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Changes E2E";
const emptyAgentName = "Empty Workspace E2E";
const noWorkspaceAgentName = "No Workspace E2E";
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");
const { CheckpointStore } = require("../../dist/main/workspace/checkpoints.js");

const results = [];
let vite = null;
let app = null;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function write(relative, content) {
  const file = path.join(workspace, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

async function pause(ms = 8) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function seed() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  write("src/demo.ts", "export const value = 1;\n");
  write("src/other.ts", "export const other = 1;\n");
  write("lib/Helper.java", "public class Helper {\n  static int value() { return 42; }\n}\n");
  write("README.md", "# Demo\nA sample workspace.\n");
  write(
    "docs/guide.md",
    "# Guide\n\nIntro text.\n\n- First\n- Second\n\n| Name | Value |\n| --- | --- |\n| Alpha | 1 |\n",
  );
  write(
    "preview.html",
    '<!doctype html><html><head><style>body{background:#123;color:#fff}h1{color:#8ff}</style></head><body><h1>HTML preview</h1><p>Hello</p><script>document.body.dataset.script="ran";</script></body></html>',
  );
  fs.copyFileSync(
    path.join(appDir, "docs/guide/images/ask-mode.png"),
    path.join(workspace, "preview.png"),
  );

  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const store = new CheckpointStore(db, path.join(userData, "checkpoints"));
  const agent = db.createAgent({
    name: agentName,
    description: "Seeded changes",
    systemPrompt: "Review the changes.",
    workspaceDir: workspace,
    model: "auto",
    toolProfile: "developer",
    readOnly: false,
    memoryEnabled: false,
  });
  db.createAgent({
    name: emptyAgentName,
    description: "No recorded changes",
    systemPrompt: "Browse the workspace.",
    workspaceDir: workspace,
    model: "auto",
    toolProfile: "developer",
    readOnly: false,
    memoryEnabled: false,
  });
  db.createAgent({
    name: noWorkspaceAgentName,
    description: "No workspace folder",
    systemPrompt: "No workspace.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "developer",
    readOnly: false,
    memoryEnabled: false,
  });

  const older = db.createTurn(agent.id, "chat");
  store.capture(agent.id, older, path.join(workspace, "src/other.ts"), Buffer.from("export const other = 1;\n"));
  write("src/other.ts", "export const other = 2;\n");
  store.finalizeTurn(agent.id, older);
  db.finishTurn(older, "success");
  db.addMessage(agent.id, "user", "Update the helper.", older);
  db.addMessage(agent.id, "assistant", "I updated `src/other.ts:1-1`.", older);
  await pause();

  const latest = db.createTurn(agent.id, "chat");
  store.capture(agent.id, latest, path.join(workspace, "src/demo.ts"), Buffer.from("export const value = 1;\n"));
  write("src/demo.ts", "export const value = 2;\nexport const added = 3;\n");
  store.capture(agent.id, latest, path.join(workspace, "docs/notes.md"), null, false);
  write("docs/notes.md", "# Notes\nAdded the second value.\n");
  store.finalizeTurn(agent.id, latest);
  db.finishTurn(latest, "success");
  db.addMessage(agent.id, "user", "Update the value and add notes.", latest);
  db.addMessage(
    agent.id,
    "assistant",
    "I changed `src/demo.ts:1-2` and added `docs/notes.md:1-2`. See `README.md:1-1`. Also `Helper.java:2-2`.",
    latest,
  );

  const before = "export const value = 1;\n";
  db.close();
  return { before };
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
    await pause(250);
  }
  console.log(log.slice(-3000));
  throw new Error("Vite did not start on 5173");
}

async function shot(page, name) {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("  shot:", file);
}

async function ensureAgent(page) {
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

async function main() {
  const { before } = await seed();
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
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1440, 980);
    });
    await ensureAgent(page);

    await page.waitForSelector(".edited-files-card", { timeout: 30_000 });
    await page.waitForSelector(".header-workspace", { timeout: 30_000 });
    const card = page.locator(".edited-files-card").last();
    const cardText = await card.innerText();
    check("the thread shows the latest edited-files card", /Edited 2 files/.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 160));
    check("the card lists both changed paths", /src\/demo\.ts/.test(cardText) && /docs\/notes\.md/.test(cardText));
    check("the header shows the latest totals", /\+4/.test(await page.locator(".header-workspace").innerText()));
    await shot(page, "01-card");

    await page.locator(".header-workspace").click();
    await page.waitForSelector(".changes-panel", { timeout: 15_000 });
    check("the changes panel opens and the desk closes", (await page.locator(".agent-desk").count()) === 0);
    await page.waitForFunction(
      () => document.querySelectorAll(".changes-tree-file").length === 2,
      null,
      { timeout: 15_000 },
    );
    await page.waitForSelector(".changes-diff-scroll .diff-line", { timeout: 15_000 });
    check("the changed section lists both files", true);
    const diffText = await page.locator(".changes-diff-scroll").innerText();
    check(
      "the diff shows the old and new values",
      /value = 1/.test(diffText) && /value = 2/.test(diffText),
      diffText.replace(/\s+/g, " ").slice(0, 160),
    );
    await shot(page, "02-panel");

    const panel = page.locator(".changes-panel");
    const splitWidth = await panel.evaluate((element) => element.getBoundingClientRect().width);
    await page.getByRole("button", { name: "Collapse chat" }).click();
    await page.waitForFunction(
      () => document.querySelector(".app-shell")?.classList.contains("is-chat-collapsed"),
      null,
      { timeout: 10_000 },
    );
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector(".center-column")).display === "none",
      null,
      { timeout: 10_000 },
    );
    const wideWidth = await panel.evaluate((element) => element.getBoundingClientRect().width);
    check(
      "sliding the chat left widens the workspace",
      wideWidth > splitWidth + 100,
      `${Math.round(splitWidth)} -> ${Math.round(wideWidth)}`,
    );
    await shot(page, "02b-workspace-wide");
    await page.getByRole("button", { name: "Show chat" }).click();
    await page.waitForFunction(
      () => !document.querySelector(".app-shell")?.classList.contains("is-chat-collapsed"),
      null,
      { timeout: 10_000 },
    );
    const restoredWidth = await panel.evaluate((element) => element.getBoundingClientRect().width);
    check(
      "showing the chat restores the split",
      Math.abs(restoredWidth - splitWidth) < 2,
      `${Math.round(restoredWidth)} vs ${Math.round(splitWidth)}`,
    );

    await page.keyboard.press("Control+P");
    const filterFocused = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") ?? "",
    );
    check("Ctrl+P focuses the workspace filter", filterFocused === "Filter workspace files", filterFocused);
    const filter = page.locator('[aria-label="Filter workspace files"]');
    await filter.fill("README");
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".workspace-tree-file").length === 1 &&
        document.querySelector(".workspace-tree-file .workspace-tree-name")?.textContent === "README.md",
      null,
      { timeout: 10_000 },
    );
    check("the filter narrows the loaded tree", true);
    await filter.fill("");

    const firstCitation = page.locator("article.message .md-citation", { hasText: "src/demo.ts:1-2" }).last();
    await firstCitation.click();
    await page.waitForFunction(
      () => /src\/demo\.ts:1[–-]2/.test(document.querySelector(".changes-cite-context")?.textContent ?? ""),
      null,
      { timeout: 15_000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".diff-line.is-cited").length >= 1,
      null,
      { timeout: 15_000 },
    );
    const cited = await page.locator(".diff-line.is-cited").count();
    check("a citation opens in place in the Changes panel", (await page.locator(".modal").count()) === 0);
    check("the cited range is marked in the diff", cited >= 1, String(cited));
    const references = await page.locator(".citation-ref").count();
    check("the panel lists every citation in the answer", references === 4, String(references));
    await shot(page, "03-cited-diff");

    const readmeCitation = page.locator("article.message .md-citation", { hasText: "README.md:1-1" }).last();
    await readmeCitation.click();
    await page.waitForFunction(
      () => /README\.md/.test(document.querySelector(".changes-diff-name")?.textContent ?? ""),
      null,
      { timeout: 15_000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".citation-line.is-target").length === 1,
      null,
      { timeout: 15_000 },
    );
    check(
      "a citation without a recorded change opens the file in place",
      /No recorded change/.test(await page.locator(".changes-diff-foot").innerText()),
    );
    await shot(page, "04-cited-code");

    const readmeRow = page.locator(".workspace-tree-file", { hasText: "README.md" }).first();
    await readmeRow.waitFor({ timeout: 15_000 });
    await readmeRow.click();
    await page.waitForFunction(
      () =>
        /README\.md/.test(document.querySelector(".changes-diff-name")?.textContent ?? "") &&
        Boolean(document.querySelector(".citation-code")),
      null,
      { timeout: 15_000 },
    );
    const explorerText = await page.locator(".workspace-tree-list").innerText();
    check(
      "All files browses the workspace read-only",
      /README\.md/.test(explorerText) &&
        /No recorded change/.test(await page.locator(".changes-diff-foot").innerText()),
      explorerText.replace(/\s+/g, " ").slice(0, 160),
    );
    await shot(page, "04b-explorer");

    const helperCitation = page
      .locator("article.message .md-citation", { hasText: "Helper.java:2-2" })
      .last();
    await helperCitation.click();
    await page.waitForFunction(
      () => /lib\/Helper\.java/.test(document.querySelector(".changes-diff-name")?.textContent ?? ""),
      null,
      { timeout: 15_000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".citation-line.is-target").length === 1,
      null,
      { timeout: 15_000 },
    );
    check(
      "a bare file name citation resolves inside the workspace",
      /return 42/.test(await page.locator(".citation-code").innerText()) &&
        /No recorded change/.test(await page.locator(".changes-diff-foot").innerText()),
      await page.locator(".changes-diff-name").innerText(),
    );
    await shot(page, "04a-bare-name-citation");

    const imageRow = page.locator(".workspace-tree-file", { hasText: "preview.png" }).first();
    await imageRow.waitFor({ timeout: 15_000 });
    await imageRow.click();
    await page.waitForSelector(".changes-image-preview img", { timeout: 15_000 });
    const imageSrc = await page.locator(".changes-image-preview img").getAttribute("src");
    check(
      "All files previews images",
      Boolean(imageSrc?.startsWith("data:image/png;base64,")),
      imageSrc?.slice(0, 34) ?? "no src",
    );
    await shot(page, "04c-image");

    const demoRow = page.locator(".workspace-tree-file", { hasText: "demo.ts" }).first();
    await demoRow.click();
    await page.waitForFunction(
      () =>
        /src\/demo\.ts/.test(document.querySelector(".changes-diff-name")?.textContent ?? "") &&
        Boolean(document.querySelector(".citation-code")),
      null,
      { timeout: 15_000 },
    );
    check(
      "a changed file opens read-only from All files",
      /recorded change/.test(await page.locator(".changes-diff-foot").innerText()),
    );
    await page.getByRole("button", { name: "View diff" }).click();
    await page.waitForFunction(
      () =>
        /src\/demo\.ts/.test(document.querySelector(".changes-diff-name")?.textContent ?? "") &&
        Boolean(document.querySelector(".diff-line")),
      null,
      { timeout: 15_000 },
    );
    check("View diff returns to the turn diff", true);

    await page.locator(".workspace-tree-folder", { hasText: "docs" }).click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".workspace-tree-file")].some((row) =>
          row.textContent?.includes("notes.md"),
        ),
      null,
      { timeout: 15_000 },
    );
    check("expanding a folder loads its files", true);

    const markdownRow = page.locator(".workspace-tree-file", { hasText: "guide.md" }).first();
    await markdownRow.waitFor({ timeout: 15_000 });
    await markdownRow.click();
    await page.waitForSelector(".changes-markdown-preview .md-heading", { timeout: 15_000 });
    const markdownText = await page.locator(".changes-markdown-preview").innerText();
    check(
      "Markdown opens as a rendered preview",
      /Guide/.test(markdownText) && /Alpha/.test(markdownText),
      markdownText.replace(/\s+/g, " ").slice(0, 160),
    );
    await shot(page, "04d-markdown");
    await page.locator(".changes-view-toggle").getByRole("button", { name: "Source" }).click();
    await page.waitForSelector(".changes-diff-scroll .citation-code", { timeout: 15_000 });
    check(
      "Markdown has a source view",
      /# Guide/.test(await page.locator(".citation-code").innerText()),
    );

    const htmlRow = page.locator(".workspace-tree-file", { hasText: "preview.html" }).first();
    await htmlRow.click();
    await page.waitForSelector(".changes-html-preview iframe", { timeout: 15_000 });
    const frame = page.frameLocator(".changes-html-preview iframe");
    await frame.locator("h1").waitFor({ timeout: 15_000 });
    const htmlHeading = await frame.locator("h1").innerText();
    const scriptRan = await frame.locator("body").getAttribute("data-script");
    check(
      "HTML opens as a sandboxed preview",
      htmlHeading === "HTML preview" && scriptRan === null,
      `${htmlHeading} / script ${scriptRan ?? "blocked"}`,
    );
    await shot(page, "04e-html");

    await firstCitation.click();
    await page.waitForFunction(
      () => /src\/demo\.ts:1[–-]2/.test(document.querySelector(".changes-cite-context")?.textContent ?? ""),
      null,
      { timeout: 15_000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".diff-line.is-cited").length >= 1,
      null,
      { timeout: 15_000 },
    );

    await page.locator(".changes-diff-foot .btn-danger-outline").click();
    await page.waitForSelector(".confirm-modal", { timeout: 10_000 });
    await page.locator(".confirm-modal .btn-destructive").click();
    await page.waitForSelector(".confirm-modal", { state: "detached", timeout: 20_000 });
    await page.waitForFunction(
      () => document.querySelectorAll(".changes-tree-file").length === 1,
      null,
      { timeout: 20_000 },
    );
    check("revert file restores the old content", fs.readFileSync(path.join(workspace, "src/demo.ts"), "utf8") === before);

    await page.locator(".changes-undo").click();
    await page.waitForSelector(".confirm-modal", { timeout: 10_000 });
    await page.locator(".confirm-modal .btn-destructive").click();
    await page.waitForSelector(".confirm-modal", { state: "detached", timeout: 20_000 });
    await page.waitForFunction(
      () => !document.querySelector(".changes-cite-context") && Boolean(document.querySelector(".changes-tree-file")),
      null,
      { timeout: 20_000 },
    );
    await page.waitForFunction(
      () => /src\/other\.ts/.test(document.querySelector(".changes-diff-name")?.textContent ?? ""),
      null,
      { timeout: 15_000 },
    );
    check("revert turn removes the created notes", !fs.existsSync(path.join(workspace, "docs/notes.md")));
    check("revert turn keeps the older file change", /src\/other\.ts/.test(await page.locator(".changes-diff-name").innerText()));
    await page.waitForFunction(
      () =>
        ![...document.querySelectorAll(".workspace-tree-file")].some((row) =>
          row.textContent?.includes("notes.md"),
        ),
      null,
      { timeout: 20_000 },
    );
    check("the tree drops a file removed by a revert", true);
    await shot(page, "05-after-revert");

    await page.getByRole("button", { name: "Close changes" }).click();
    await page.waitForSelector(".changes-panel", { state: "detached", timeout: 10_000 });
    await page.locator('button[aria-label="Show agent desk"]').click();
    await page.waitForSelector(".agent-desk", { timeout: 10_000 });
    check("the desk keeps a one-line changes summary", /src\/other\.ts|1 file/.test(await page.locator(".desk-change-summary").innerText()));

    const deskBrowse = page.locator(".agent-desk").getByRole("button", { name: "Browse files" });
    await deskBrowse.scrollIntoViewIfNeeded();
    await shot(page, "05b-desk-browse");
    await deskBrowse.click();
    await page.waitForSelector(".changes-panel", { timeout: 15_000 });
    check("the desk opens the workspace browser", true);
    await page.getByRole("button", { name: "Close changes" }).click();
    await page.waitForSelector(".changes-panel", { state: "detached", timeout: 10_000 });

    await page.locator(".agent-row").filter({ hasText: emptyAgentName }).first().click();
    await page.waitForFunction(
      (name) => document.querySelector(".chat-title h1")?.textContent?.trim() === name,
      emptyAgentName,
      { timeout: 15_000 },
    );
    const browse = page.locator(".header-workspace");
    await browse.waitFor({ timeout: 15_000 });
    const browseLabel = await browse.innerText();
    check(
      "the header offers workspace browsing with no changes",
      /Workspace/.test(browseLabel),
      browseLabel.replace(/\s+/g, " ").trim(),
    );
    await browse.click();
    await page.waitForSelector(".changes-panel", { timeout: 15_000 });
    await page.waitForFunction(
      () => /No recorded changes/.test(document.querySelector(".changes-panel")?.textContent ?? ""),
      null,
      { timeout: 15_000 },
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".workspace-tree-file").length > 0,
      null,
      { timeout: 15_000 },
    );
    const emptyPanel = await page.locator(".changes-panel").innerText();
    check(
      "All files opens with no recorded changes",
      /No recorded changes/.test(emptyPanel) && /Select a file/.test(emptyPanel),
      emptyPanel.replace(/\s+/g, " ").slice(0, 160),
    );
    await shot(page, "06-browse-empty");

    await page.getByRole("button", { name: "Close changes" }).click();
    await page.waitForSelector(".changes-panel", { state: "detached", timeout: 10_000 });
    await page.locator(".composer-input").fill("/files");
    await page.locator(".command-menu").getByRole("option", { name: /\/files/ }).click();
    await page.waitForSelector(".changes-panel", { timeout: 15_000 });
    check("/files opens the workspace browser", true);
    await page.getByRole("button", { name: "Close changes" }).click();
    await page.waitForSelector(".changes-panel", { state: "detached", timeout: 10_000 });

    await page.locator(".agent-row").filter({ hasText: noWorkspaceAgentName }).first().click();
    await page.waitForFunction(
      (name) => document.querySelector(".chat-title h1")?.textContent?.trim() === name,
      noWorkspaceAgentName,
      { timeout: 15_000 },
    );
    check(
      "the workspace button is hidden without a workspace",
      (await page.locator(".header-workspace").count()) === 0,
    );
    await page.locator(".composer-input").fill("/files");
    await page.waitForSelector(".command-menu", { timeout: 10_000 });
    check(
      "the files command is hidden without a workspace",
      (await page.locator(".command-menu").getByRole("option", { name: /\/files/ }).count()) === 0,
    );
  } finally {
    await app?.close().catch(() => undefined);
    if (vite) {
      vite.kill();
      await pause(250);
      vite = null;
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  console.log(`ARTIFACTS: ${root}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
