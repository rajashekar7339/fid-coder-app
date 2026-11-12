// Tests the image extension map shared by the main process and the renderer.

import assert from "node:assert/strict";
import test from "node:test";
import { imageMimeForPath } from "../../src/shared/image.ts";

test("maps supported image extensions", () => {
  assert.equal(imageMimeForPath("assets/logo.png"), "image/png");
  assert.equal(imageMimeForPath("photo.JPG"), "image/jpeg");
  assert.equal(imageMimeForPath("photo.jpeg"), "image/jpeg");
  assert.equal(imageMimeForPath("anim.gif"), "image/gif");
  assert.equal(imageMimeForPath("hero.webp"), "image/webp");
  assert.equal(imageMimeForPath("icon.ico"), "image/x-icon");
  assert.equal(imageMimeForPath("art.avif"), "image/avif");
});

test("leaves text and unknown files alone", () => {
  assert.equal(imageMimeForPath("README.md"), null);
  assert.equal(imageMimeForPath("src/main/index.ts"), null);
  assert.equal(imageMimeForPath("archive.zip"), null);
  assert.equal(imageMimeForPath("no-extension"), null);
});
