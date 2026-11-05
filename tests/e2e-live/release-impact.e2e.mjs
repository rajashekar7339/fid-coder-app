// Live end-to-end test for the release-impact analyst.
//
// Usage:
//   npm run build:node
//   node tests/e2e-live/release-impact.e2e.mjs
//   FID_RUN_AGENT=1 node tests/e2e-live/release-impact.e2e.mjs
//
// Every UI click waits FID_SLOW_MS milliseconds first (default 3000) so the
// run is easy to watch. Set FID_CLEAN=1 to delete the temporary workspace and
// screenshots after a successful run. The app closes after FID_KEEP_OPEN_MS
// (default 10000).
//
// The deterministic part creates a temporary git workspace, runs the CLI
// analysis, and checks the analyst desk. FID_RUN_AGENT=1 also sends one real
// Copilot turn and checks that the analyst called impact_analyze.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-release-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const slowMs = Number(process.env.FID_SLOW_MS ?? "3000");
const keepOpenMs = Number(process.env.FID_KEEP_OPEN_MS ?? "10000");
const runAgent = process.env.FID_RUN_AGENT === "1";
const clean = process.env.FID_CLEAN === "1";
const agentName = "Release Impact Analyst";

const results = [];
let vite = null;
let app = null;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function git(cwd, args) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "E2E",
      GIT_AUTHOR_EMAIL: "e2e@example.com",
      GIT_COMMITTER_NAME: "E2E",
      GIT_COMMITTER_EMAIL: "e2e@example.com",
    },
    encoding: "utf8",
  }).trim();
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "e2e@example.com"]);
  git(dir, ["config", "user.name", "E2E"]);
}

function commit(dir, message) {
  git(dir, ["add", "."]);
  git(dir, ["commit", "-qm", message]);
}

function rev(dir) {
  return git(dir, ["rev-parse", "HEAD"]);
}

function prepareWorkspace() {
  const service = path.join(workspace, "repos", "service");
  const automation = path.join(workspace, "repos", "automation");
  fs.mkdirSync(path.join(workspace, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(workspace, ".release-impact"), { recursive: true });
  fs.mkdirSync(shots, { recursive: true });

  initRepo(service);
  write(
    path.join(service, "src", "app.ts"),
    'export const version = 1;\nexport const endpoint = "/api/orders/price";\n',
  );
  write(
    path.join(service, "src", "ApplyButton.tsx"),
    'export const ApplyButton = () => <button data-testid="apply">Apply</button>;\n',
  );
  write(path.join(service, "package-lock.json"), '{"lockfileVersion":3,"a":1}\n');
  commit(service, "base");
  const base = rev(service);

  write(
    path.join(service, "src", "app.ts"),
    'export const version = 2;\nexport const endpoint = "/api/orders/discount";\n',
  );
  write(
    path.join(service, "src", "ApplyButton.tsx"),
    'export const ApplyButton = () => <button data-testid="apply-discount">Apply</button>;\n',
  );
  write(path.join(service, "package-lock.json"), '{"lockfileVersion":3,"a":2}\n');
  commit(service, "PAY-812 add discount");
  const candidate = rev(service);

  initRepo(automation);
  write(
    path.join(automation, "tests", "discount.spec.ts"),
    [
      'import { test } from "@playwright/test";',
      'test.describe("checkout", () => {',
      '  test("Checkout applies a discount [TC-1042]", async ({ page }) => {',
      '    await page.getByTestId("apply").click();',
      '    await page.goto("/api/orders/discount");',
      "  });",
      "});",
      "",
    ].join("\n"),
  );
  commit(automation, "tests");
  const automationSha = rev(automation);

  write(
    path.join(workspace, ".release-impact", "config.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        repos: [
          { id: "service", path: "repos/service", role: "source", prod: base, candidate },
          {
            id: "automation",
            path: "repos/automation",
            role: "automation",
            framework: "playwright",
            testGlobs: ["tests/**/*.spec.ts"],
            caseIdPattern: "TC-\\d+",
            prod: automationSha,
            candidate: automationSha,
          },
        ],
        mapping: {
          explicit: [{ match: "service/src/**", tests: ["automation/tests/**"] }],
        },
        policy: {
          fullRegression: ["**/package-lock.json"],
          minMappingCoverage: 0.7,
          maxChangedFiles: 400,
        },
        outputs: {
          report: "artifacts/impact-report.md",
          selection: "artifacts/selected-tests.json",
          selectionFormat: "playwright-grep",
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function slowClick(page, locator, label) {
  console.log(`  click: ${label} (waiting ${slowMs} ms)`);
  await sleep(slowMs);
  await locator.click();
}

async function shot(page, name) {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("  shot:", file);
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

async function selectAnalyst(page) {
  const title = await page.locator(".chat-title h1").first().innerText().catch(() => "");
  if (title.trim() === agentName) return;
  const row = page.locator(".agent-row").filter({ hasText: agentName }).first();
  await row.waitFor({ timeout: 30_000 });
  await slowClick(page, row, `agent row ${agentName}`);
  await page.waitForFunction(
    (name) => document.querySelector(".chat-title h1")?.textContent?.trim() === name,
    agentName,
    { timeout: 15_000 },
  );
}

async function main() {
  prepareWorkspace();
  const cli = path.join(appDir, "dist", "cli", "release-impact.js");
  if (!fs.existsSync(cli)) throw new Error("Run `npm run build:node` before this harness");

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
    console.log(`Copilot signed in: ${status.signedIn === true} (${status.authStatus})`);

    const analyst = await page.evaluate(async () => {
      const agents = await window.fid.agents.list();
      return agents.find((agent) => agent.name === "Release Impact Analyst") ?? null;
    });
    check("seeded release analyst exists", Boolean(analyst));
    if (!analyst) throw new Error("Release Impact Analyst was not seeded");

    await page.evaluate(
      async ({ id, folder }) => {
        const current = (await window.fid.agents.list()).find((agent) => agent.id === id);
        if (!current) throw new Error("Release Impact Analyst was not found");
        await window.fid.agents.update(id, {
          name: current.name,
          description: current.description,
          systemPrompt: current.systemPrompt,
          workspaceDir: folder,
          model: current.model,
          toolProfile: current.toolProfile,
          memoryEnabled: current.memoryEnabled,
          skillIds: current.skillIds,
        });
      },
      { id: analyst.id, folder: workspace },
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".app-shell", { timeout: 60_000 });
    await selectAnalyst(page);
    await shot(page, "01-analyst");

    if ((await page.locator(".agent-desk").count()) === 0) {
      await slowClick(page, page.locator('button[aria-label="Show agent desk"]'), "show agent desk");
      await page.waitForSelector(".agent-desk", { timeout: 10_000 });
    }
    await page.waitForFunction(
      () => document.querySelector(".desk-section")?.textContent?.includes("Release impact"),
      { timeout: 15_000 },
    );
    await page.waitForFunction(
      () => document.body.textContent?.includes("No release selection yet"),
      { timeout: 15_000 },
    );
    check("analyst desk starts without a selection", true);
    await shot(page, "02-empty-impact");

    const cliResult = spawnSync(process.execPath, [cli, "analyze"], {
      cwd: workspace,
      encoding: "utf8",
    });
    console.log("CLI analyze:\n" + `${cliResult.stdout}${cliResult.stderr}`.trim());
    check("analyze exits 3 for full regression", cliResult.status === 3, `exit=${cliResult.status}`);

    const selectionPath = path.join(workspace, "artifacts", "selected-tests.json");
    const reportPath = path.join(workspace, "artifacts", "impact-report.md");
    const selection = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
    const report = fs.readFileSync(reportPath, "utf8");
    check("selection has TC-1042 in mustRun", selection.mustRun.some((test) => test.id === "TC-1042"));
    check("selection recommends full regression", selection.fullRegression === true);
    check(
      "report puts full regression first",
      report.indexOf("## Full regression") >= 0 && report.indexOf("## Full regression") < report.indexOf("## Must run"),
    );

    await page.waitForFunction(
      () => {
        const banner = document.querySelector(".impact-banner");
        return Boolean(banner && banner.textContent?.includes("Full regression recommended"));
      },
      { timeout: 20_000, polling: 500 },
    );
    const impactText = await page.locator(".desk-section").filter({ hasText: "Release impact" }).innerText();
    check("desk shows the full-regression banner", impactText.includes("Full regression recommended"));
    check("desk shows TC-1042", impactText.includes("TC-1042"), impactText.replace(/\s+/g, " ").slice(0, 200));
    check("desk shows the selector risk", impactText.includes("Update the locator"), impactText.replace(/\s+/g, " ").slice(0, 200));
    await shot(page, "03-impact-report");

    const copy = page.locator(".desk-section").filter({ hasText: "Release impact" }).locator("button.text-button").first();
    await slowClick(page, copy, "copy selection");
    await page.waitForFunction(
      () => [...document.querySelectorAll(".desk-section .text-button")].some((button) => button.textContent?.includes("Copied")),
      { timeout: 5_000 },
    );
    const copyText = await copy.innerText().catch(() => "");
    check("copy selection button responds", copyText.includes("Copied"), copyText);
    await shot(page, "04-copied");

    if (runAgent && status.signedIn === true) {
      const prompt = [
        "Call impact_analyze with the default config.",
        "Do not use dryRun.",
        "Do not write any files.",
        "Reply with the must-run count only.",
      ].join(" ");
      await page.locator(".composer-input").fill(prompt);
      await slowClick(page, page.getByRole("button", { name: "Send message" }), "send agent prompt");
      await page.waitForFunction(
        () => Boolean(document.querySelector('button[aria-label="Stop generating"]')) || Boolean(document.querySelector(".chat-error")),
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
      const cards = await page.locator(".tool-card").filter({ hasText: "Analyzed the release" }).count();
      check("agent called impact_analyze", cards > 0, `${cards} matching tool cards`);
      await shot(page, "05-agent-turn");
    } else {
      console.log(`agent turn skipped: FID_RUN_AGENT=${runAgent ? "1" : "0"}, signedIn=${status.signedIn === true}`);
    }

    console.log("WORKSPACE:", workspace);
    console.log("SHOTS:", shots);
    if (keepOpenMs > 0) {
      console.log(`Keeping the Electron window open for ${keepOpenMs} ms...`);
      await page.waitForTimeout(keepOpenMs);
    }
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
  console.error("RELEASE IMPACT E2E FAILED:", error);
  process.exitCode = 1;
});
