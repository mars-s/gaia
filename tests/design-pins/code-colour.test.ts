import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";




test("strings use primary ink while comments use secondary ink in both themes", () => {
 const theme = readFileSync(new URL("../../apps/web/styles/theme.css", import.meta.url), "utf8");
 assert.match(theme, /--color-code-string: var\(--color-ink\)/);
 assert.match(theme, /--color-code-comment: var\(--color-ink-2\)/);
 assert.doesNotMatch(theme, /--color-code-string: var\(--color-ink-[23]\)/);
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /code-string \{ color: var\(--color-code-string\)/);
 });
