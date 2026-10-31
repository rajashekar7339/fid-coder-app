// Tests workspace listing, globbing, and text search tools and their profile access.
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { exploreTools } = require("../../dist/tools/explore/explore.js");
const { toolsForAgent } = require("../../dist/tools/registry.js");

const tools = Object.fromEntries(exploreTools.map((tool) => [tool.name, tool]));

function context(workspaceDir) {
  return {
    agentId: "agent-1",
    workspaceDir,
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

test("explore tools stay off the browser profile and on the developer profile", () => {
  const browser = toolsForAgent("browser").map((tool) => tool.name);
  const developer = toolsForAgent("developer").map((tool) => tool.name);
  for (const name of ["list_dir", "glob_files", "search_text"]) {
    assert.equal(browser.includes(name), false);
    assert.equal(developer.includes(name), true);
  }
  assert.equal(developer.includes("file_read"), true);
  assert.equal(developer.some((name) => name.startsWith("browser_")), false);
});

test("lists, finds, and searches without walking skipped folders", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-explore-"));
  const ctx = context(root);
  try {
    write(root, "readme.md", "hello desk\n");
    write(root, "src/app.ts", "export function runTurn() { return 1; }\n");
    write(root, "src/main/runner.ts", "export function runTurn() { return 2; }\n");
    write(root, "src/util.ts", "export const name = \"fid\";\n");
    write(root, "node_modules/secret/index.js", "export const hidden = \"needle-secret\";\n");
    write(root, "dist/old.ts", "export const built = \"dist-only-marker\";\n");
    write(root, "release/note.txt", "release-marker\n");
    write(root, ".git/config", "git-marker\n");
    write(root, "target/classes/App.java", "maven-marker\n");
    write(root, "build/libs/app.txt", "gradle-marker\n");
    write(root, ".gradle/cache.txt", "gradle-cache-marker\n");
    write(root, ".idea/workspace.xml", "idea-marker\n");

    const listed = await tools.list_dir.handler({}, ctx);
    assert.match(listed, /\[dir\] src/);
    assert.match(listed, /\[file\] readme.md/);
    assert.doesNotMatch(listed, /node_modules|\[dir\] dist|\[dir\] release|\[dir\] \.git|\[dir\] target|\[dir\] build|\[dir\] \.gradle|\[dir\] \.idea/);

    const explicit = await tools.list_dir.handler({ path: "node_modules" }, ctx);
    assert.match(explicit, /\[dir\] secret/);

    const nested = await tools.glob_files.handler({ pattern: "*.ts" }, ctx);
    assert.match(nested, /src\/app.ts/);
    assert.match(nested, /src\/main\/runner.ts/);
    assert.doesNotMatch(nested, /node_modules|dist\/old.ts/);

    const shallow = await tools.glob_files.handler({ pattern: "src/*.ts" }, ctx);
    assert.match(shallow, /src\/app.ts/);
    assert.doesNotMatch(shallow, /runner.ts/);

    const runners = await tools.glob_files.handler({ pattern: "*runner*" }, ctx);
    assert.match(runners, /src\/main\/runner.ts/);

    const inFile = await tools.search_text.handler({ pattern: "return 2", path: "src/main/runner.ts", context: 0 }, ctx);
    assert.match(inFile, /return 2/);
    const found = await tools.search_text.handler({ pattern: "runTurn", context: 0 }, ctx);
    assert.match(found, /src\/main\/runner.ts/);
    assert.match(found, /runTurn/);
    assert.equal(await tools.search_text.handler({ pattern: "needle-secret" }, ctx), "No matches.");
    assert.equal(await tools.search_text.handler({ pattern: "dist-only-marker" }, ctx), "No matches.");
    assert.equal(await tools.search_text.handler({ pattern: "maven-marker" }, ctx), "No matches.");
    assert.equal(await tools.search_text.handler({ pattern: "gradle-marker" }, ctx), "No matches.");
    assert.equal(await tools.search_text.handler({ pattern: "idea-marker" }, ctx), "No matches.");
    const maven = await tools.search_text.handler({ pattern: "maven-marker", path: "target", context: 0 }, ctx);
    assert.match(maven, /maven-marker/);
    const javaFiles = await tools.glob_files.handler({ pattern: "*.java" }, ctx);
    assert.doesNotMatch(javaFiles, /target/);
    const scoped = await tools.search_text.handler({ pattern: "needle-secret", path: "node_modules" }, ctx);
    assert.match(scoped, /needle-secret/);
    const markdown = await tools.search_text.handler({ pattern: "hello", glob: "*.md" }, ctx);
    assert.match(markdown, /readme.md/);
    assert.equal(await tools.search_text.handler({ pattern: "runT..n" }, ctx), "No matches.");
    const regex = await tools.search_text.handler({ pattern: "runT..n", regex: true, context: 0 }, ctx);
    assert.match(regex, /runTurn/);

    await assert.rejects(tools.list_dir.handler({ path: "../outside" }, ctx), /outside the workspace/);
    await assert.rejects(tools.glob_files.handler({ pattern: "*.ts", path: ".." }, ctx), /outside the workspace/);
    await assert.rejects(tools.search_text.handler({ pattern: "x", path: ".." }, ctx), /outside the workspace/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
