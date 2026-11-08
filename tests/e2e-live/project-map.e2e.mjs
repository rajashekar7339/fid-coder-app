// Live end-to-end test for building the cached project map.
//
// Usage:
//   npm run test:map
//   FID_CLEAN=1 npm run test:map
//
// Requirements:
//   - Copilot CLI signed in on this machine.
//   - `npm run build:node` output present (the npm script runs it).
//
// One real read-only Copilot turn builds the map. The test also checks that the
// workspace is unchanged and that reopening uses the cached map.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-project-map-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Project Map E2E";
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
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, "package.json"),
    JSON.stringify({ name: "map-fixture", scripts: { dev: "vite", test: "node --test" } }, null, 2),
  );
  fs.writeFileSync(
    path.join(workspace, "README.md"),
    "# Map fixture\n\nA tiny app that sends a message through a bridge.\n\n## Architecture\n\nThe renderer calls the main process through a preload bridge.\n",
  );
  fs.writeFileSync(
    path.join(workspace, "src", "index.ts"),
    "import { startChat } from './chat';\n\nstartChat('hello');\n",
  );
  fs.writeFileSync(
    path.join(workspace, "src", "chat.ts"),
    "export function startChat(message: string): string {\n  return `sent ${message}`;\n}\n",
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

function fingerprint(dir) {
  const hash = createHash("sha256");
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const relative = path.relative(dir, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      hash.update(relative);
      hash.update(fs.readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest("hex");
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
  const before = fingerprint(workspace);
  await ensureVite();
  try {
    const page = await launch();
    const status = await page.evaluate(() => window.fid.settings.get({ refreshAuth: true }));
    check("signed in to Copilot", status.signedIn === true, status.authStatus);
    if (!status.signedIn) throw new Error("Copilot is not signed in; cannot build a live map");

    await page.evaluate(
      ({ name, folder }) =>
        window.fid.agents.create({
          name,
          description: "Temporary agent for the project map check",
          systemPrompt: "Answer from the workspace.",
          workspaceDir: folder,
          model: "auto",
          toolProfile: "developer",
          readOnly: true,
          memoryEnabled: false,
        }),
      { name: agentName, folder: workspace },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-shell", { timeout: 60_000 });
    await page.locator(".agent-row").filter({ hasText: agentName }).first().click();
    await page.waitForFunction(
      (name) => document.querySelector(".chat-title h1")?.textContent?.trim() === name,
      agentName,
      { timeout: 15_000 },
    );

    await page.getByRole("button", { name: "Open project map" }).click();
    await page.waitForFunction(
      () => document.querySelector(".project-map-modal .map-empty")?.textContent?.includes("No project map yet"),
      null,
      { timeout: 15_000 },
    );
    check("the map starts unbuilt", true);
    await page.locator(".project-map-modal .map-empty .btn-primary").click();

    await page.waitForFunction(
      () =>
        Boolean(document.querySelector(".project-map-modal .map-content")) ||
        Boolean(document.querySelector(".project-map-modal .map-empty.is-error")),
      null,
      { timeout: 240_000, polling: 500 },
    );
    const mapError = await page.locator(".project-map-modal .map-empty.is-error").innerText().catch(() => "");
    if (mapError) throw new Error(`map error: ${mapError.replace(/\s+/g, " ")}`);

    const mapText = await page.locator(".project-map-modal .map-content").innerText();
    check(
      "the live map has overview and components",
      /overview/i.test(mapText) && /components/i.test(mapText),
      mapText.replace(/\s+/g, " ").slice(0, 180),
    );
    check(
      "the live map names a real fixture file",
      /src\/index\.ts|src\/chat\.ts|README\.md|package\.json/i.test(mapText),
    );
    check("the live map leaves the workspace unchanged", fingerprint(workspace) === before);
    await page.screenshot({ path: path.join(shots, "01-project-map.png") });
    console.log("  shot:", path.join(shots, "01-project-map.png"));

    await page.getByRole("button", { name: "Close project map" }).click();
    await page.waitForSelector(".project-map-modal", { state: "detached", timeout: 10_000 });
    await page.getByRole("button", { name: "Open project map" }).click();
    await page.waitForSelector(".project-map-modal .map-content", { timeout: 15_000 });
    check("reopening uses the cached map", (await page.locator(".project-map-modal .map-meta").innerText()).includes("Up to date"));
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
  console.error("PROJECT MAP FAILED:", error);
  process.exitCode = 1;
});
