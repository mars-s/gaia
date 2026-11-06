import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupGlyph } from "./setup-glyph";
import { readFileSync } from "node:fs";

test("every setup has a distinct shared glyph across navigation and settings", () => {
  const icons = (["single", "bots", "channels", "sessions"] as const).map(layout =>
    renderToStaticMarkup(createElement(SetupGlyph, { layout })));
  assert.equal(new Set(icons).size, 4);
  for (const file of ["chat-switcher.tsx", "experiences/index.tsx", "experiences/view.tsx", "experiences/proposal.tsx"]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /<SetupGlyph layout=/);
  }
});

test("workspace glyph differs from the hashtag used only for channels", () => {
  const source = readFileSync(new URL("./setup-glyph.tsx", import.meta.url), "utf8");
  assert.match(source, /channels: RiLayoutColumnLine/);
  assert.doesNotMatch(source, /RiHashtag/);
  assert.match(readFileSync(new URL("./experiences/view.tsx", import.meta.url), "utf8"), /layout === "channels" && <RiHashtag/);
});
