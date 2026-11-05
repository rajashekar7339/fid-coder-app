// Live end-to-end test for per-agent skills.
//
// Usage:
//   npm run test:skills
//   FID_CLEAN=1 npm run test:skills
//
// Requirements:
//   - `npm run build:node` output present (the npm script runs it).
//   - No Copilot turn is needed. The test creates an agent and checks the
//     skill library, the editor, the chat bar, and the context preview.
//
// The test launches its own Electron instance with a temporary userData
// directory and a temporary workspace. It reuses Vite on port 5173 if one is
// running; otherwise it starts and stops its own.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-skills-"));
const userData = path.join(root, "userdata");
const workspace = path.join(root, "workspace");
const shots = path.join(root, "shots");
const agentName = "Skills E2E";
const clean = process.env.FID_CLEAN === "1";

const results = [];
let vite = null;
let app = null;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

function writeSkill(file, name, description, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`, "utf8");
}

function prepare() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  writeSkill(
    path.join(workspace, ".github", "skills", "project-review", "SKILL.md"),
    "Project review",
    "Review this repo with its own rules.",
    "Read the repository rules before reviewing.",
  );
  writeSkill(
    path.join(userData, "skills", "user-lean", "SKILL.md"),
    "User lean",
    "Use the shared helper.",
    "Prefer the shared helper.",
  );
  const broken = path.join(workspace, ".github", "skills", "broken");
  fs.mkdirSync(broken, { recursive: true });
  fs.writeFileSync(path.join(broken, "SKILL.md"), "---\nname: Broken\n---\n\nNo description.\n", "utf8");
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

async function main() {
  prepare();
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

    await page.getByRole("button", { name: "New agent" }).first().click();
    await page.waitForSelector(".agent-modal", { timeout: 15_000 });
    await page.getByLabel("Name").fill(agentName);
    await page.getByLabel("Instructions").fill("Check the skills UI.");
    await page.locator("#agent-workspace").fill(workspace);
    await page.waitForFunction(() => document.querySelectorAll(".skill-option").length >= 4, {
      timeout: 30_000,
    });

    const optionText = await page.locator(".skill-options").innerText();
    check("workspace skill is discovered", /Project review[\s\S]*Workspace/.test(optionText));
    check("user skill is discovered", /User lean[\s\S]*Your skills/.test(optionText));
    check(
      "built-in skills are discovered",
      /Write lean[\s\S]*Built-in/.test(optionText) && /Review a change[\s\S]*Built-in/.test(optionText),
    );
    check("skill sizes are shown", /\d[\d,]* chars/.test(optionText));
    const warnings = await page.locator(".skill-warnings").innerText().catch(() => "");
    check("malformed skill is reported", /broken/.test(warnings), warnings.replace(/\s+/g, " ").slice(0, 120));

    await page.getByRole("checkbox", { name: /Project review/ }).check();
    await page.getByRole("checkbox", { name: /User lean/ }).check();
    await page.getByRole("checkbox", { name: /Write lean/ }).check();
    check("selection count is shown", (await page.locator(".field-optional").filter({ hasText: "3/8" }).count()) > 0);
    check(
      "selected budget is shown",
      (await page.getByText(/Selected: .*16,000 chars/).count()) > 0,
    );

    const projectRow = page.locator(".skill-option-wrap", { hasText: "Project review" });
    await projectRow.getByRole("button", { name: "View" }).click();
    await page.waitForSelector(".skill-preview pre", { timeout: 15_000 });
    const previewText = await page.locator(".skill-preview pre").innerText();
    const previewPath = await page.locator(".skill-preview-path").innerText();
    check("view shows the skill body", /Read the repository rules before reviewing/.test(previewText));
    check(
      "view shows the skill path",
      /project-review/.test(previewPath) && /SKILL\.md/.test(previewPath),
      previewPath,
    );
    await page.locator(".skill-options").scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await shot(page, "01-skills-dialog");

    check(
      "open folder action exists",
      (await page.getByRole("button", { name: "Open skills folder" }).count()) === 1,
    );
    await page.getByRole("button", { name: "Refresh" }).click();
    await page.waitForTimeout(700);
    check("refresh keeps the catalog", (await page.locator(".skill-option").count()) >= 4);
    check("refresh keeps the selection", await page.getByRole("checkbox", { name: /Project review/ }).isChecked());

    await page.getByRole("button", { name: "Create agent" }).click();
    await page.waitForSelector(".agent-modal", { state: "detached", timeout: 20_000 });
    await page.waitForSelector(".chat-skillbar", { timeout: 20_000 });
    const bar = await page.locator(".chat-skillbar").innerText();
    check(
      "chat bar lists the skills",
      ["Project review", "User lean", "Write lean"].every((name) => bar.includes(name)),
      bar.replace(/\s+/g, " "),
    );
    await shot(page, "02-chat-skills");

    await page.locator(".composer-input").fill("/");
    await page.waitForSelector(".command-menu", { timeout: 10_000 });
    const commandMenuText = await page.locator(".command-menu").innerText();
    check(
      "slash menu lists commands",
      ["/review", "/skills", "/help"].every((id) => commandMenuText.includes(id)),
      commandMenuText.replace(/\s+/g, " ").slice(0, 120),
    );
    await shot(page, "02-commands");
    await page.locator(".composer-input").press("Enter");
    check(
      "selecting /review fills the composer",
      (await page.locator(".composer-input").inputValue()).trim() === "/review",
    );
    await page.locator(".composer-input").fill("");

    await page.getByRole("button", { name: /JIRA Agent/ }).first().click();
    await page.waitForTimeout(500);
    check("another agent has no skill bar", (await page.locator(".chat-skillbar").count()) === 0);
    await page.getByRole("button", { name: /Skills E2E/ }).first().click();
    await page.waitForSelector(".chat-skillbar", { timeout: 15_000 });
    check("the original agent keeps its skills", (await page.locator(".chat-skillbar").innerText()).includes("Project review"));

    const preview = await page.evaluate(async (name) => {
      const agents = await window.fid.agents.list();
      const agent = agents.find((item) => item.name === name);
      if (!agent) return null;
      const view = await window.fid.context.preview(agent.id);
      return { tools: view.tools, skillNames: view.skillNames, systemMessage: view.systemMessage };
    }, agentName);
    check("context exposes review_code", Boolean(preview?.tools.includes("review_code")));
    check(
      "context includes the selected skills",
      ["Project review", "User lean", "Write lean"].every((name) => preview?.skillNames.includes(name)),
    );
    check(
      "context includes the workspace skill body",
      /Read the repository rules before reviewing/.test(preview?.systemMessage ?? ""),
    );
    check(
      "system message hides the internal tool name",
      !/review_code/.test(preview?.systemMessage ?? ""),
    );

    await page.locator(".composer-input").fill("/skills");
    await page.waitForSelector(".command-menu", { timeout: 10_000 });
    await page.locator(".composer-input").press("Enter");
    await page.waitForSelector(".agent-modal", { timeout: 15_000 });
    await page.waitForFunction(() => document.querySelectorAll(".skill-option").length >= 4, {
      timeout: 30_000,
    });
    check(
      "saved skills persist in the editor",
      (await page.getByRole("checkbox", { name: /Project review/ }).isChecked()) &&
        (await page.getByRole("checkbox", { name: /Write lean/ }).isChecked()),
    );
    await page.getByRole("checkbox", { name: /Write lean/ }).uncheck();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForSelector(".agent-modal", { state: "detached", timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const bar = document.querySelector(".chat-skillbar");
        return Boolean(bar && bar.textContent?.includes("Project review") && !bar.textContent?.includes("Write lean"));
      },
      { timeout: 15_000 },
    );
    check("removing a skill updates the chat bar", true);
    await shot(page, "03-chat-after-remove");

    await page.locator(".composer-input").fill("/help");
    await page.waitForSelector(".command-menu", { timeout: 10_000 });
    await page.locator(".composer-input").press("Enter");
    await page.waitForSelector(".help-modal", { timeout: 10_000 });
    await page.getByRole("button", { name: /Add skills to an agent/ }).click();
    await page.waitForSelector(".help-article", { timeout: 10_000 });
    const helpText = await page.locator(".help-article").innerText();
    check(
      "help guide has the skills article",
      /Where skills come from/.test(helpText) &&
        /Commands in the composer/.test(helpText) &&
        /\/review/.test(helpText),
    );
    await shot(page, "04-help-skills");
    await page.getByRole("button", { name: "Close help" }).click();
    await page.waitForSelector(".help-modal", { state: "detached", timeout: 10_000 });
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
  console.error("SKILLS SMOKE FAILED:", error);
  process.exitCode = 1;
});
