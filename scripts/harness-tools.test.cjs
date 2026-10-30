const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { fileTools } = require("../dist/tools/files/files.js");
const { gitTools, parseGitHubRemote } = require("../dist/tools/git/git.js");
const { exploreCodeTool } = require("../dist/tools/explore/explore-code.js");
const { toolsForAgent } = require("../dist/tools/registry.js");
const { summarizeTool } = require("../dist/shared/summary.js");
const { workspaceBrief } = require("../dist/main/workspace/workspace-brief.js");

const files = Object.fromEntries(fileTools.map((tool) => [tool.name, tool]));
const git = Object.fromEntries(gitTools.map((tool) => [tool.name, tool]));

function context(workspaceDir) {
  return {
    agentId: "agent-1",
    workspaceDir,
    model: "auto",
    browser: {},
    githubPat: null,
    jiraToken: null,
    jiraSite: null,
  };
}

function write(root, relative, content) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function runGit(cwd, args) {
  return spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

const gitAvailable = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true }).status === 0;
const ghAvailable = spawnSync("gh", ["--version"], { encoding: "utf8", windowsHide: true }).status === 0;

test("parseGitHubRemote reads GitHub remotes", () => {
  assert.deepEqual(parseGitHubRemote("https://github.com/acme/widget.git"), {
    api: "https://api.github.com",
    owner: "acme",
    repo: "widget",
  });
  assert.deepEqual(parseGitHubRemote("git@github.com:acme/widget.git"), {
    api: "https://api.github.com",
    owner: "acme",
    repo: "widget",
  });
  assert.deepEqual(parseGitHubRemote("ssh://git@github.com/acme/widget.git"), {
    api: "https://api.github.com",
    owner: "acme",
    repo: "widget",
  });
  assert.deepEqual(parseGitHubRemote("https://x-access-token:secret@github.com/acme/widget.git"), {
    api: "https://api.github.com",
    owner: "acme",
    repo: "widget",
  });
  assert.deepEqual(parseGitHubRemote("https://github.example.com/acme/widget"), {
    api: "https://github.example.com/api/v3",
    owner: "acme",
    repo: "widget",
  });
  assert.equal(parseGitHubRemote("https://example.com/onlyone"), null);
});

test("developer tools include patch, git, and explore, and the browser profile does not", () => {
  const browser = toolsForAgent("browser").map((tool) => tool.name);
  const developer = toolsForAgent("developer").map((tool) => tool.name);
  for (const name of ["read_many", "apply_patch", "git_status", "git_diff", "git_log", "gh_pr_view", "gh_pr_diff", "explore_code"]) {
    assert.equal(developer.includes(name), true, name);
    assert.equal(browser.includes(name), false, name);
  }
});

test("summarizeTool keeps one line", () => {
  assert.equal(summarizeTool("search_text", true, "src/app.ts:1:run\nnext\nlast"), "search_text: src/app.ts:1:run (+2 more lines)");
  assert.equal(summarizeTool("git_status", false, "not a repository"), "git_status: failed: not a repository");
});

test("workspace brief, patch, batch read, and git tools", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-harness-"));
  const ctx = context(root);
  try {
    write(root, "README.md", "# Desk app\n\nHello\n");
    write(root, "package.json", JSON.stringify({ scripts: { dev: "vite", test: "node --test" } }));
    write(root, "pom.xml", "<project><artifactId>desk-maven</artifactId></project>\n");
    write(root, "src/main/App.java", "public class App {\r\n  int value = 1;\r\n}\r\n");
    write(root, "src/main/Note.java", "class Note {}\n");
    write(root, "target/classes/Hidden.java", "maven-marker\n");
    write(root, "same.txt", "same\nsame\n");

    if (gitAvailable) {
      assert.equal(runGit(root, ["init", "-b", "main"]).status, 0);
      assert.equal(runGit(root, ["add", "."]).status, 0);
      const committed = runGit(root, ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "init harness"]);
      assert.equal(committed.status, 0, committed.stderr);
    }

    const brief = await workspaceBrief(root);
    assert.match(brief, /src\//);
    assert.match(brief, /main\//);
    assert.match(brief, /package.json scripts: dev, test/);
    assert.match(brief, /desk-maven/);
    assert.match(brief, /Desk app/);
    assert.doesNotMatch(brief, /target|maven-marker/);
    if (gitAvailable) assert.match(brief, /init harness/);
    write(root, "src/main/Later.java", "class Later {}\n");
    assert.equal(await workspaceBrief(root), brief);

    const patched = await files.apply_patch.handler(
      { path: "src/main/App.java", old_string: "value = 1", new_string: "value = 2" },
      ctx,
    );
    assert.equal(patched, "patched App.java");
    const updated = fs.readFileSync(path.join(root, "src/main/App.java"), "utf8");
    assert.match(updated, /value = 2/);
    assert.match(updated, /\r\n/);
    await assert.rejects(
      files.apply_patch.handler({ path: "same.txt", old_string: "same", new_string: "other" }, ctx),
      /matched 2 times/,
    );
    await assert.rejects(
      files.apply_patch.handler({ path: "src/main/App.java", old_string: "missing", new_string: "x" }, ctx),
      /not found/,
    );
    await assert.rejects(
      files.apply_patch.handler({ path: "../outside.java", old_string: "a", new_string: "b" }, ctx),
      /outside the workspace/,
    );

    const batch = await files.read_many.handler(
      {
        files: [
          { path: "src/main/App.java", limit: 5 },
          { path: "src/main/Note.java" },
        ],
      },
      ctx,
    );
    assert.match(batch, /## src\/main\/App.java/);
    assert.match(batch, /value = 2/);
    assert.match(batch, /## src\/main\/Note.java/);
    assert.match(batch, /class Note/);
    await assert.rejects(
      files.read_many.handler({ files: Array.from({ length: 9 }, () => ({ path: "same.txt" })) }, ctx),
      /at most 8/,
    );

    await assert.rejects(exploreCodeTool.handler({ question: "where is App" }, ctx), /unavailable/);
    await assert.rejects(git.gh_pr_view.handler({ number: "abc" }, ctx), /pull request number/);

    if (gitAvailable) {
      const status = await git.git_status.handler({}, ctx);
      assert.match(status, /App\.java/);
      const diff = await git.git_diff.handler({ path: "src/main/App.java", full: true }, ctx);
      assert.match(diff, /value = 2/);
      const log = await git.git_log.handler({ limit: 5 }, ctx);
      assert.match(log, /init harness/);
      await assert.rejects(git.git_diff.handler({ path: "../outside.java" }, ctx), /outside the workspace/);
      if (!ghAvailable) {
        await assert.rejects(git.gh_pr_view.handler({ number: "1" }, ctx), /no origin remote/);
        runGit(root, ["remote", "add", "origin", "https://example.com/onlyone"]);
        await assert.rejects(git.gh_pr_view.handler({ number: "1" }, ctx), /not a GitHub/);
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
