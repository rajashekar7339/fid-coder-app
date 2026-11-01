// Tests parsing GitHub HTTPS, SSH, token, and enterprise remotes.
const assert = require("node:assert/strict");
const test = require("node:test");
const { parseGitHubRemote } = require("../../dist/tools/git/git.js");

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
