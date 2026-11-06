import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { EmptyChat, starters } from "./empty-chat";
import { readFileSync } from "node:fs";
test("empty chat offers three draft-only starters and setups omit them", () => {
 const html = renderToStaticMarkup(createElement(EmptyChat, { onStarter() {} }));
 assert.equal((html.match(/class="starter"/g) ?? []).length, 3);
 for (const text of starters) assert.ok(html.includes(text));
 assert.doesNotMatch(renderToStaticMarkup(createElement(EmptyChat)), /Suggestions/);
 const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
 assert.match(app, /!currentDraft.draft.text && !currentDraft.draft.images.length/);
 assert.match(app, /input\?\.setSelectionRange\(text.length, text.length\)/);
});
