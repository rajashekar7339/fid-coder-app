import assert from "node:assert/strict";
import test from "node:test";
import {
  confluenceBaseUrl,
  confluenceLinkTarget,
  confluencePageUrl,
  confluenceText,
  confluenceToolsReady,
  normalizeConfluenceSite,
  storageHasMacros,
} from "../../src/shared/confluence.ts";

test("Cloud Confluence uses /wiki and stores the site origin", () => {
  assert.equal(
    confluenceBaseUrl("https://team.atlassian.net/wiki", "cloud"),
    "https://team.atlassian.net/wiki",
  );
  assert.equal(
    normalizeConfluenceSite("https://team.atlassian.net/wiki/", "cloud"),
    "https://team.atlassian.net",
  );
});

test("Data Center keeps its context path", () => {
  assert.equal(
    confluenceBaseUrl("https://wiki.example.com/confluence/", "data-center"),
    "https://wiki.example.com/confluence",
  );
  assert.equal(
    normalizeConfluenceSite("https://wiki.example.com/confluence", "data-center"),
    "https://wiki.example.com/confluence",
  );
});

test("page links resolve against the REST base", () => {
  assert.equal(
    confluencePageUrl("https://team.atlassian.net/wiki", { webui: "/spaces/DOCS/pages/1" }),
    "https://team.atlassian.net/wiki/spaces/DOCS/pages/1",
  );
  assert.equal(
    confluencePageUrl("https://team.atlassian.net/wiki", { webui: "/wiki/spaces/DOCS/pages/1" }),
    "https://team.atlassian.net/wiki/spaces/DOCS/pages/1",
  );
  assert.equal(
    confluencePageUrl("https://wiki.example.com/confluence", { webui: "/confluence/display/DOCS/Home" }),
    "https://wiki.example.com/confluence/display/DOCS/Home",
  );
  assert.equal(
    confluencePageUrl("https://team.atlassian.net/wiki", { webui: "https://team.atlassian.net/x" }),
    "https://team.atlassian.net/x",
  );
});

test("pasted page links become ids or space and title", () => {
  const cloud = "https://team.atlassian.net/wiki";
  const cloudTarget = confluenceLinkTarget(
    cloud,
    "https://team.atlassian.net/wiki/spaces/ENG/pages/123456/Release+Notes",
  );
  assert.equal(cloudTarget.id, "123456");
  assert.equal(cloudTarget.spaceKey, "ENG");
  assert.equal(cloudTarget.unresolved, false);

  const dc = "https://wiki.example.com/confluence";
  const display = confluenceLinkTarget(dc, `${dc}/display/ENG/Release+Notes`);
  assert.equal(display.spaceKey, "ENG");
  assert.equal(display.title, "Release Notes");
  assert.equal(display.unresolved, false);

  const old = confluenceLinkTarget(dc, `${dc}/pages/viewpage.action?pageId=987`);
  assert.equal(old.id, "987");
  assert.equal(old.unresolved, false);

  const short = confluenceLinkTarget(cloud, `${cloud}/x/AbCd`);
  assert.equal(short.unresolved, true);
});

test("a link outside the saved Confluence site is refused", () => {
  assert.throws(
    () => confluenceLinkTarget("https://team.atlassian.net/wiki", "https://other.example/wiki/spaces/DOC/pages/1"),
    /configured Confluence site/,
  );
  assert.throws(
    () =>
      confluenceLinkTarget(
        "https://wiki.example.com/confluence",
        "https://wiki.example.com/jira/spaces/DOC/pages/1",
      ),
    /configured Confluence site/,
  );
});

test("readable text loses tags and decodes entities", () => {
  assert.equal(
    confluenceText("<h1>Release</h1><p>Alpha &amp; beta<br/>next</p>"),
    "Release\nAlpha & beta\nnext",
  );
});

test("macros are detected before a replace", () => {
  assert.equal(storageHasMacros('<p>ok</p>'), false);
  assert.equal(storageHasMacros('<ac:structured-macro ac:name="toc"/>'), true);
});

test("Confluence is ready only with the fields its auth needs", () => {
  assert.equal(confluenceToolsReady("https://wiki", "me@example.com", "cloud", "token"), true);
  assert.equal(confluenceToolsReady("https://wiki", "", "cloud", "token"), false);
  assert.equal(confluenceToolsReady("https://wiki", "", "data-center", "token"), true);
  assert.equal(confluenceToolsReady("https://wiki", "", "data-center", null), false);
  assert.equal(confluenceToolsReady("", "", "data-center", "token"), false);
});
