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
  write("README.md", "# Demo\nA sample workspace.\n");

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
    "I changed `src/demo.ts:1-2` and added `docs/notes.md:1-2`. See `README.md:1-1`.",
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
    await page.waitForSelector(".header-changes", { timeout: 30_000 });
    const card = page.locator(".edited-files-card").last();
    const cardText = await card.innerText();
    check("the thread shows the latest edited-files card", /Edited 2 files/.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 160));
    check("the card lists both changed paths", /src\/demo\.ts/.test(cardText) && /docs\/notes\.md/.test(cardText));
    check("the header shows the latest totals", /\+4/.test(await page.locator(".header-changes").innerText()));
    await shot(page, "01-card");

    await page.locator(".header-changes").click();
    await page.waitForSelector(".changes-panel", { timeout: 15_000 });
    check("the changes panel opens and the desk closes", (await page.locator(".agent-desk").count()) === 0);
    await page.waitForFunction(
      () => document.querySelectorAll(".changes-tree-file").length === 2,
      null,
      { timeout: 15_000 },
    );
    await page.waitForSelector(".changes-diff-scroll .diff-line", { timeout: 15_000 });
    check("the file tree groups both files", true);
    const diffText = await page.locator(".changes-diff-scroll").innerText();
    check(
      "the diff shows the old and new values",
      /value = 1/.test(diffText) && /value = 2/.test(diffText),
      diffText.replace(/\s+/g, " ").slice(0, 160),
    );
    await shot(page, "02-panel");

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
    check("the panel lists every citation in the answer", references === 3, String(references));
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
    await shot(page, "05-after-revert");

    await page.getByRole("button", { name: "Close changes" }).click();
    await page.waitForSelector(".changes-panel", { state: "detached", timeout: 10_000 });
    await page.locator('button[aria-label="Show agent desk"]').click();
    await page.waitForSelector(".agent-desk", { timeout: 10_000 });
    check("the desk keeps a one-line changes summary", /src\/other\.ts|1 file/.test(await page.locator(".desk-change-summary").innerText()));
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
