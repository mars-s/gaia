import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
test("dark draft thumbnails remain visible and narrow chips keep their remove control inside", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /dark \.draft-images \.image-unavailable \{ background: var\(--color-surface-selected\)/);
 assert.match(css, /draft-images \.draft-file-chip \{[^}]*height: 56px/);
 assert.match(css, /draft-file-chip \.remove-image \{ position: static[^}]*width: 24px; height: 24px/);
});
