// Deterministic Electron UI test for pin, archive, and Ctrl+K.
//
// Usage:
//   npm run test:sidebar
//   FID_WATCH_MS=900 npm run test:sidebar
//
// No Copilot turn is needed. The test seeds three agents and drives the sidebar.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-sidebar-"));
const userData = path.join(root, "userdata");
const shots = path.join(root, "shots");
const watchMs = Number(process.env.FID_WATCH_MS ?? 0);
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");
const { DatabaseSync } = require("node:sqlite");

const results = [];
let vite = null;
let app = null;
let page = null;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function pause(ms = 8) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function watch(ms = watchMs) {
  if (watchMs > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

function input(name) {
  return {
    name,
    description: name === "Alpha" ? "Release notes" : "",
    systemPrompt: "Reply briefly.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly: true,
    memoryEnabled: false,
  };
}

async function seed() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  const file = path.join(userData, "fid-coder.sqlite");
  const db = new AppDatabase(file);
  for (const agent of db.listAgents()) db.deleteAgent(agent.id);
  db.createAgent(input("Gamma"));
  const alpha = db.createAgent(input("Alpha"));
  db.addMessage(alpha.id, "user", "Alpha kept this note.");
  db.createAgent(input("Beta"));
  db.close();
  const raw = new DatabaseSync(file);
  raw.prepare("UPDATE agents SET updated_at = ? WHERE name = ?").run("2026-01-01T00:00:00.000Z", "Gamma");
  raw.prepare("UPDATE agents SET updated_at = ? WHERE name = ?").run("2026-02-01T00:00:00.000Z", "Alpha");
  raw.prepare("UPDATE messages SET created_at = ? WHERE content = ?").run("2026-02-01T00:00:00.000Z", "Alpha kept this note.");
  raw.prepare("UPDATE agents SET updated_at = ? WHERE name = ?").run("2026-03-01T00:00:00.000Z", "Beta");
  raw.close();
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

async function shot(name) {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("  shot:", file);
}

async function listedNames() {
  return page.locator(".agent-list > .agent-row-wrap .agent-name-text").allInnerTexts();
}

async function openMenu(name) {
  const row = page.locator(".agent-row-wrap").filter({
    has: page.locator(".agent-name-text", { hasText: name }),
  });
  await row.locator(".agent-row").click({ button: "right" });
  await page.getByRole("menu", { name: `Actions for ${name}` }).waitFor();
}

async function titleIs(name) {
  await page.waitForFunction(
    (wanted) => document.querySelector(".chat-title h1")?.textContent?.trim() === wanted,
    name,
    { timeout: 15_000 },
  );
}

async function main() {
  await seed();
  await ensureVite();
  try {
    app = await electron.launch({
      executablePath: path.join(appDir, "node_modules", "electron", "dist", "electron.exe"),
      args: ["."],
      cwd: appDir,
      env: { ...process.env, FID_CODER_USER_DATA: userData },
      timeout: 60_000,
    });
    page = await app.firstWindow({ timeout: 60_000 });
    page.on("pageerror", (error) => console.log("[pageerror]", error.message));
    await page.waitForSelector(".app-shell", { timeout: 60_000 });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1280, 900);
    });
    await page.waitForSelector(".agent-row", { timeout: 30_000 });
    await titleIs("Beta");
    check("the working list is newest first", JSON.stringify(await listedNames()) === JSON.stringify(["Beta", "Alpha", "Gamma"]));
    await shot("01-list");

    await page.getByRole("button", { name: "New agent" }).first().click();
    await page.getByRole("dialog", { name: "New agent" }).waitFor();
    await page.keyboard.press("Control+K");
    await watch();
    const dialogFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("Ctrl+K leaves an open dialog alone", dialogFocus !== "Search agents", dialogFocus ?? "");
    await page.keyboard.press("Escape");
    await page.getByRole("dialog", { name: "New agent" }).waitFor({ state: "detached" });

    await page.keyboard.press("Control+K");
    await watch();
    const searchFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    check("Ctrl+K focuses search", searchFocus === "Search agents", searchFocus ?? "");
    await page.locator("[aria-label='Search agents']").fill("Gam");
    await page.keyboard.press("Enter");
    await titleIs("Gamma");
    check("Enter opens the first match", true);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("[aria-label='Search agents']")?.value === "");
    check("Escape clears the search", JSON.stringify(await listedNames()) === JSON.stringify(["Beta", "Alpha", "Gamma"]));
    await shot("02-search");

    await openMenu("Gamma");
    await page.getByRole("menuitem", { name: "Pin" }).click();
    await page.waitForFunction(
      () => document.querySelector(".agent-list > .agent-row-wrap .agent-name-text")?.textContent === "Gamma",
    );
    check("pin moves the agent to the top", (await listedNames())[0] === "Gamma");
    check("a pinned row shows a pin", (await page.locator(".agent-list > .agent-row-wrap .agent-pin").count()) === 1);
    await shot("03-pinned");
    await openMenu("Gamma");
    await page.getByRole("menuitem", { name: "Unpin" }).click();
    await page.waitForFunction(
      () => document.querySelector(".agent-list > .agent-row-wrap .agent-name-text")?.textContent === "Beta",
    );
    check("unpin restores activity order", JSON.stringify(await listedNames()) === JSON.stringify(["Beta", "Alpha", "Gamma"]));

    await openMenu("Alpha");
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.locator(".archive-group").waitFor();
    const afterArchive = await listedNames();
    check(
      "archive leaves the main list",
      JSON.stringify(afterArchive) === JSON.stringify(["Beta", "Gamma"]),
      JSON.stringify(afterArchive),
    );
    check("the archive row shows the count", (await page.locator(".archive-group .count").innerText()) === "1");
    check("the agent count skips archived agents", (await page.locator(".sidebar > .sidebar-section-label .count").innerText()) === "2");
    await page.locator(".archive-group").getByRole("button", { name: "Archived" }).click();
    await page.locator(".archive-group .agent-name-text", { hasText: "Alpha" }).click();
    await titleIs("Alpha");
    await page.locator(".user-bubble", { hasText: "Alpha kept this note." }).waitFor();
    check("an archived conversation stays", true);
    await shot("04-archived");

    await page.keyboard.press("Control+K");
    await page.locator("[aria-label='Search agents']").fill("release");
    await page.waitForFunction(() => document.querySelector(".archive-group") === null);
    check("search finds an archived agent by description", JSON.stringify(await listedNames()) === JSON.stringify(["Alpha"]));
    await page.keyboard.press("Enter");
    await titleIs("Alpha");
    await page.keyboard.press("Escape");
    await page.locator(".archive-group .agent-name-text", { hasText: "Alpha" }).waitFor();

    await openMenu("Alpha");
    await page.getByRole("menuitem", { name: "Restore" }).click();
    await page.waitForFunction(() => document.querySelector(".archive-group") === null);
    check(
      "restore returns the agent",
      JSON.stringify(await listedNames()) === JSON.stringify(["Beta", "Alpha", "Gamma"]),
    );

    await openMenu("Beta");
    await page.getByRole("menuitem", { name: "Pin" }).click();
    await page.waitForFunction(
      () => document.querySelector(".agent-list > .agent-row-wrap .agent-name-text")?.textContent === "Beta",
    );
    await openMenu("Beta");
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await page.locator(".archive-group").waitFor();
    const archivedPin = page.locator(".archive-group .agent-pin");
    if ((await archivedPin.count()) === 0) {
      await page.locator(".archive-group").getByRole("button", { name: "Archived" }).click();
    }
    await archivedPin.waitFor();
    check("archive keeps the pin", (await page.locator(".archive-group .agent-pin").count()) === 1);
    await openMenu("Beta");
    await page.getByRole("menuitem", { name: "Restore" }).click();
    await page.waitForFunction(
      () => document.querySelector(".agent-list > .agent-row-wrap .agent-name-text")?.textContent === "Beta",
    );
    check("restore puts a pinned agent back on top", (await page.locator(".agent-list > .agent-row-wrap .agent-pin").count()) === 1);
    await shot("05-restored");
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
