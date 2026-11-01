// Tests release-impact config checks and a fixture git analysis.
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { parsePlaywright } = require("../../dist/main/release-impact/adapters/playwright.js");
const { validateImpactConfig } = require("../../dist/main/release-impact/config.js");
const { analyzeRelease, explainImpact } = require("../../dist/main/release-impact/index.js");
const { fileTools } = require("../../dist/tools/files/files.js");

const fileWrite = fileTools.find((tool) => tool.name === "file_write");

function config(extra = {}) {
  return {
    schemaVersion: 1,
    repos: [
      { id: "service", path: "repos/service", role: "source", prod: "HEAD", candidate: "HEAD" },
      {
        id: "automation",
        path: "repos/automation",
        role: "automation",
        framework: "playwright",
        testGlobs: ["tests/**/*.spec.ts"],
        prod: "HEAD",
        candidate: "HEAD",
      },
    ],
    outputs: {
      report: "artifacts/impact-report.md",
      selection: "artifacts/selected-tests.json",
      selectionFormat: "playwright-grep",
    },
    ...extra,
  };
}

test("config rejects an unknown field, a secret, a bad version, and a path outside the workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-impact-config-"));
  try {
    const unknown = validateImpactConfig(root, config({ teamName: "secret" }));
    assert.ok(unknown.errors.some((error) => error.includes("teamName")));
    const secret = validateImpactConfig(root, config({ team: "ghp_abcdefghijklmnopqrstuvwxyz" }));
    assert.ok(secret.errors.some((error) => error.includes("secret")));
    const version = validateImpactConfig(root, config({ schemaVersion: 2 }));
    assert.ok(version.errors.some((error) => error.includes("schemaVersion")));
    const outside = validateImpactConfig(root, config({
      repos: [{ id: "service", path: "../outside", role: "source" }],
    }));
    assert.equal(outside.config, null);
    assert.ok(outside.errors.some((error) => /inside the workspace|relative path/.test(error)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the playwright adapter reads a test id and a selector", () => {
  const parsed = parsePlaywright(
    [
      'test.describe("checkout", () => {',
      '  test("Checkout applies a discount [TC-1042]", async ({ page }) => {',
      '    await page.getByTestId("apply").click();',
      "  });",
      "});",
    ].join("\n"),
    "TC-\\d+",
  );
  assert.equal(parsed[0].id, "TC-1042");
  assert.equal(parsed[0].signals.selectors.includes("apply"), true);
});

test("an analyst write cannot leave artifacts/", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-impact-write-"));
  const ctx = {
    agentId: "agent-1",
    workspaceDir: root,
    writeRoot: "artifacts",
    browser: {},
    githubPat: null,
    jiraToken: null,
    jiraSite: null,
  };
  try {
    await assert.rejects(fileWrite.handler({ path: "src/App.ts", content: "nope" }, ctx), /artifacts/);
    const wrote = await fileWrite.handler({ path: "artifacts/impact-report.md", content: "# Report\n" }, ctx);
    assert.match(wrote, /wrote/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("analyze selects the mapped test and writes the report", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-impact-git-"));
  try {
    const service = path.join(root, "repos", "service");
    const automation = path.join(root, "repos", "automation");
    fs.mkdirSync(path.join(service, "src", "orders"), { recursive: true });
    fs.mkdirSync(path.join(automation, "tests", "orders"), { recursive: true });
    write(service, "src/orders/Price.java", 'public class PriceService {\n  String path = "/api/orders/price";\n}\n');
    write(service, "src/orders/ApplyButton.tsx", 'export const ApplyButton = () => <button data-testid="apply">Apply</button>;\n');
    commit(service, "base");
    const prod = rev(service);
    write(service, "src/orders/Price.java", 'public class PriceService {\n  String path = "/api/orders/discount";\n}\n');
    write(service, "src/orders/ApplyButton.tsx", 'export const ApplyButton = () => <button data-testid="apply-discount">Apply</button>;\n');
    commit(service, "PAY-812 add discount expiry");
    const candidate = rev(service);
    write(
      automation,
      "tests/orders/discount.spec.ts",
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
    fs.mkdirSync(path.join(root, ".release-impact"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".release-impact", "config.json"),
      JSON.stringify({
        schemaVersion: 1,
        repos: [
          { id: "service", path: "repos/service", role: "source", prod, candidate },
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
          explicit: [{ match: "service/src/**/orders/**", tests: ["automation/tests/orders/**"] }],
        },
        policy: { maxChangedFiles: 400, allowCustomAdapters: false },
        outputs: {
          report: "artifacts/impact-report.md",
          selection: "artifacts/selected-tests.json",
          selectionFormat: "playwright-grep",
        },
      }),
    );

    const dry = await analyzeRelease({ workspaceDir: root, dryRun: true });
    assert.equal(dry.exitCode, 0, JSON.stringify(dry.summary));
    assert.equal(fs.existsSync(path.join(root, "artifacts", "selected-tests.json")), false);
    assert.equal(dry.summary.mustRun.some((item) => item.id === "TC-1042"), true);
    assert.equal(dry.summary.risks.some((risk) => risk.category === "selector-drift"), true);
    assert.equal(dry.summary.newScenarios.some((item) => item.source === "PAY-812"), true);

    const written = await analyzeRelease({ workspaceDir: root });
    assert.equal(written.exitCode, 0, JSON.stringify(written.summary));
    const report = fs.readFileSync(path.join(root, "artifacts", "impact-report.md"), "utf8");
    assert.ok(report.indexOf("## Full regression") < report.indexOf("## Must run"));
    const explained = explainImpact(root, "TC-1042");
    assert.equal(explained.exitCode, 0);
    assert.match(explained.text, /TC-1042/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function write(root, relative, content) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function git(cwd, args) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
    encoding: "utf8",
  });
}

function commit(cwd, message) {
  if (!fs.existsSync(path.join(cwd, ".git"))) {
    git(cwd, ["init"]);
    git(cwd, ["config", "user.email", "test@example.com"]);
    git(cwd, ["config", "user.name", "Test"]);
  }
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", message]);
}

function rev(cwd) {
  return git(cwd, ["rev-parse", "HEAD"]).trim();
}
