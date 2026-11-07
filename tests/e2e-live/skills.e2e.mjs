// Live end-to-end test for the global skills library and /skills picker.
//
// Usage:
//   npm run test:skills
//   FID_CLEAN=1 npm run test:skills
//
// Requirements:
//   - `npm run build:node` output present (the npm script runs it).
//   - No Copilot turn is needed. The test creates an agent and checks the
//     library, upload, versions, command menu, picker, context preview, and guide.
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
const uploadSource = path.join(root, "upload", "uploaded-skill");
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

function writeSkill(file, name, description, body, version = null) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const front = [`name: ${name}`, `description: ${description}`];
  if (version) front.push(`version: ${version}`);
  fs.writeFileSync(file, `---\n${front.join("\n")}\n---\n\n${body}\n`, "utf8");
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
    "2.0.0",
  );
  writeSkill(
    path.join(workspace, ".skills", "dot-skill", "SKILL.md"),
    "From dot skills",
    "A workspace .skills example.",
    "Use the workspace dot skills folder.",
    "1.0.0",
  );
  writeSkill(
    path.join(userData, "skills", "user-lean", "SKILL.md"),
    "User lean",
    "Use the shared helper.",
    "Prefer the shared helper.",
    "1.0.0",
  );
  writeSkill(
    path.join(uploadSource, "SKILL.md"),
    "Uploaded skill",
    "Added by the end-to-end test.",
    "Follow the uploaded instructions.",
    "1.1.0",
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

async function composerValue(page) {
  return page.locator(".composer-input").inputValue();
}

async function main() {
  prepare();
  await ensureVite();
  try {
    app = await electron.launch({
      executablePath: path.join(appDir, "node_modules", "electron", "dist", "electron.exe"),
      args: ["."],
      cwd: appDir,
      env: {
        ...process.env,
        FID_CODER_USER_DATA: userData,
        FID_CODER_SKILL_IMPORT_DIR: uploadSource,
      },
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
    check(
      "agent editor has no per-agent skills field",
      (await page.locator(".agent-modal").getByText("Skills", { exact: true }).count()) === 0 &&
        (await page.locator(".skill-options").count()) === 0,
    );
    await page.getByRole("button", { name: "Create agent" }).click();
    await page.waitForSelector(".agent-modal", { state: "detached", timeout: 20_000 });
    check("chat has no permanent skill bar", (await page.locator(".chat-skillbar").count()) === 0);

    await page.getByRole("button", { name: "Open skills" }).click();
    await page.waitForSelector(".skills-modal", { timeout: 15_000 });
    await page.waitForFunction(() => document.querySelectorAll(".skill-card").length >= 5, { timeout: 30_000 });

    const library = await page.locator(".skills-modal").innerText();
    check(
      "library shows all skills",
      ["User lean", "Project review", "From dot skills", "Write lean", "Review a change"].every((name) =>
        library.includes(name),
      ),
      library.replace(/\s+/g, " ").slice(0, 240),
    );
    check("library shows sources", /Your skills/.test(library) && /Workspace/.test(library) && /Built-in/.test(library));
    check("library shows versions", /v2\.0\.0/.test(library) && /v1\.0\.0/.test(library));
    check("library shows sizes", /chars/.test(library));
    await shot(page, "01-skills-library");

    const warningsSummary = page.locator(".skill-warnings summary");
    if (await warningsSummary.count()) await warningsSummary.click();
    const warnings = await page.locator(".skill-warnings").innerText().catch(() => "");
    check("malformed skill is reported", /broken/.test(warnings), warnings.replace(/\s+/g, " ").slice(0, 120));

    writeSkill(
      path.join(userData, "skills", "refreshed-skill", "SKILL.md"),
      "Refreshed skill",
      "Added while the library is open.",
      "Follow the refreshed instructions.",
      "1.0.0",
    );
    await page.getByRole("button", { name: "Refresh skills" }).click();
    await page.waitForFunction(
      () => document.querySelector(".skills-modal")?.textContent?.includes("Refreshed skill"),
      { timeout: 20_000 },
    );
    check("refresh reloads skills without reopening", true);

    const projectCard = page.locator(".skill-card", { hasText: "Project review" });
    await projectCard.locator(".skill-card-copy").click();
    await page.waitForSelector(".skill-reader pre", { timeout: 15_000 });
    check(
      "skill row opens the reader",
      /Read the repository rules before reviewing/.test(await page.locator(".skill-reader pre").innerText()),
    );
    check(
      "reader shows the skill path",
      /project-review/.test(await page.locator(".skill-reader-path").innerText()),
    );
    await projectCard.locator(".skill-card-copy").click();
    await page.waitForSelector(".skill-reader", { state: "detached", timeout: 10_000 });
    check("reader closes", true);

    await projectCard.getByRole("button", { name: "Use" }).click();
    await page.waitForSelector(".skills-modal", { state: "detached", timeout: 10_000 });
    await page.waitForFunction(
      () => document.querySelector(".composer-input")?.value === "/skills project-review ",
      { timeout: 10_000 },
    );
    check("Use fills the composer", (await composerValue(page)) === "/skills project-review ");
    check(
      "Use shows the version in the hint",
      /v2\.0\.0/.test(await page.locator(".command-hint").innerText().catch(() => "")),
    );

    await page.getByRole("button", { name: "Open skills" }).click();
    await page.waitForSelector(".skills-modal", { timeout: 15_000 });
    await page.getByRole("button", { name: "Upload skill" }).click();
    await page.waitForFunction(
      () => document.querySelector(".skills-modal")?.textContent?.includes("Uploaded skill"),
      { timeout: 20_000 },
    );
    const afterUpload = await page.locator(".skills-modal").innerText();
    check("upload adds the skill", afterUpload.includes("Uploaded skill"));
    check("upload reports the version", /Added Uploaded skill v1\.1\.0/.test(afterUpload), afterUpload.replace(/\s+/g, " ").slice(0, 160));
    check("uploaded version is shown in the list", /v1\.1\.0/.test(afterUpload));
    await shot(page, "02-skills-after-upload");
    await page.getByRole("button", { name: "Close skills" }).click();
    await page.waitForSelector(".skills-modal", { state: "detached", timeout: 10_000 });

    await page.locator(".composer-input").fill("/");
    await page.waitForSelector(".command-menu", { timeout: 10_000 });
    const commandMenu = await page.locator(".command-menu").innerText();
    check(
      "slash menu lists commands",
      ["/review", "/skills", "/help"].every((id) => commandMenu.includes(id)),
      commandMenu.replace(/\s+/g, " ").slice(0, 120),
    );
    await page.locator(".composer-input").fill("/skills");
    await page.waitForSelector(".command-menu", { timeout: 10_000 });
    await page.locator(".composer-input").press("Enter");
    await page.waitForSelector(".skills-modal", { timeout: 10_000 });
    check("selecting /skills opens the library", true);
    await page.getByRole("button", { name: "Close skills" }).click();
    await page.waitForSelector(".skills-modal", { state: "detached", timeout: 10_000 });

    await page.locator(".composer-input").fill("/skills ");
    await page.waitForSelector(".skill-menu", { timeout: 10_000 });
    const picker = await page.locator(".skill-menu").innerText();
    check(
      "skill picker lists skills",
      ["From dot skills", "Project review", "Write lean"].every((name) => picker.includes(name)),
      picker.replace(/\s+/g, " ").slice(0, 180),
    );
    check("skill picker shows versions", /v2\.0\.0/.test(picker));
    await page.locator(".composer-input").press("Enter");
    const picked = await composerValue(page);
    check("selecting a skill fills the command", picked.startsWith("/skills ") && !picked.endsWith("/skills "), picked);
    check(
      "skill hint shows the version and asks for the task",
      /v1\.0\.0/.test(await page.locator(".command-hint").innerText().catch(() => "")) &&
        /add the task/i.test(await page.locator(".command-hint").innerText().catch(() => "")),
    );
    await shot(page, "03-skill-picker");

    const preview = await page.evaluate(async (name) => {
      const agents = await window.fid.agents.list();
      const agent = agents.find((item) => item.name === name);
      if (!agent) return null;
      const view = await window.fid.context.preview(agent.id);
      return { tools: view.tools, skillNames: view.skillNames, systemMessage: view.systemMessage };
    }, agentName);
    check("context exposes review_code", Boolean(preview?.tools.includes("review_code")));
    check("context does not list skills", preview?.skillNames === undefined);
    check(
      "system message has no skill body",
      !/Read the repository rules before reviewing/.test(preview?.systemMessage ?? ""),
    );
    check("system message hides the internal tool name", !/review_code/.test(preview?.systemMessage ?? ""));

    await page.locator(".composer-input").fill("/help");
    await page.waitForSelector(".command-menu", { timeout: 10_000 });
    await page.locator(".composer-input").press("Enter");
    await page.waitForSelector(".help-modal", { timeout: 10_000 });
    await page.getByRole("button", { name: /Use skills on demand/ }).click();
    await page.waitForSelector(".help-article", { timeout: 10_000 });
    const helpText = await page.locator(".help-article").innerText();
    check(
      "help guide has the skills article",
      /Where skills come from/.test(helpText) &&
        /\/skills/.test(helpText) &&
        /Skills library/.test(helpText) &&
        /version/i.test(helpText),
    );
    await page.waitForFunction(
      () => {
        const images = [...document.querySelectorAll(".help-article img")];
        return images.length >= 2 && images.every((image) => image.complete);
      },
      { timeout: 10_000 },
    );
    const guideImages = await page.evaluate(() =>
      [...document.querySelectorAll(".help-article img")].map((image) => ({
        src: image.src,
        complete: image.complete,
        width: image.naturalWidth,
      })),
    );
    console.log("  guide images:", JSON.stringify(guideImages));
    check(
      "help guide has the skills screenshots",
      guideImages.length >= 2 && guideImages.every((image) => image.complete && image.width > 0),
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
