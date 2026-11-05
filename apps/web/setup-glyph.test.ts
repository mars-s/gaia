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
