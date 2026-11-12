// Tests the Markdown and HTML preview routing and the HTML preview CSP.

import assert from "node:assert/strict";
import test from "node:test";
import { htmlPreviewDocument, previewKindForPath } from "../../src/shared/preview.ts";

test("routes markdown and HTML extensions", () => {
  assert.equal(previewKindForPath("README.md"), "markdown");
  assert.equal(previewKindForPath("docs/guide.markdown"), "markdown");
  assert.equal(previewKindForPath("preview.html"), "html");
  assert.equal(previewKindForPath("preview.HTM"), "html");
  assert.equal(previewKindForPath("src/main/index.ts"), null);
  assert.equal(previewKindForPath("assets/logo.png"), null);
});

test("adds a restrictive CSP to a full HTML document", () => {
  const preview = htmlPreviewDocument(
    "<!doctype html><html><head><title>Demo</title></head><body><h1>Hello</h1></body></html>",
  );
  assert.match(preview, /<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/);
  assert.match(preview, /default-src 'none'/);
  assert.match(preview, /style-src 'unsafe-inline'/);
  assert.match(preview, /<body><h1>Hello<\/h1><\/body>/);
});

test("wraps an HTML fragment", () => {
  const preview = htmlPreviewDocument("<p>Hello</p>");
  assert.match(
    preview,
    /^<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/,
  );
  assert.match(preview, /<body><p>Hello<\/p><\/body>/);
});
