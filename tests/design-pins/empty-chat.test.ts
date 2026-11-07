import { test } from "node:test";
import assert from "node:assert/strict";



import { readFileSync } from "node:fs";
test("starters are centred wrapping chips with a quiet border and keyboard focus", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /starter-list \{[^}]*flex-wrap: wrap; justify-content: center/);
 assert.match(css, /starter \{[^}]*border: 1px solid var\(--color-line-strong\)[^}]*border-radius: var\(--radius-sm\)[^}]*color: var\(--color-ink-2\)/);
 assert.match(css, /starter:hover[^}]*var\(--color-surface-hover\)/);
 assert.match(css, /starter:focus-visible[^}]*outline: 2px solid var\(--color-focus\)/);
});
