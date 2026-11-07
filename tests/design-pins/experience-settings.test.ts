import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";





test("only Original chat keeps the manual creation action directly after its list", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /setup-settings > ul \{ flex: none/);
 assert.match(css, /setup-create[^}]*margin-top: 12px/);
});
test("setup rows use unfilled rows, visible actions and wrapping descriptions", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.doesNotMatch(css, /setup-list-row\[aria-current="page"\][^}]*background/);
 assert.match(css, /setup-name \+ p \{ white-space: normal; overflow-wrap: anywhere/);
 assert.match(css, /setup-row-actions \{ justify-content: flex-start/);
 const source = readFileSync(new URL("../../apps/web/experiences/index.tsx", import.meta.url), "utf8");
 assert.doesNotMatch(source, /More actions|Make main chat|You’re here/);
 assert.match(source, /controller.makeMain\(item.id\)/);
 assert.match(source, /<Menu.RadioItem closeOnClick/);
 assert.match(source, /Menu.Popup finalFocus=\{false\}/);
 assert.match(source, /useLayoutEffect\(\(\) => \{[^]*if \(!makingMain && restoreMainFocus.current\)/);
 assert.match(source, /mainTrigger.current\?\.focus\(\)/);
 assert.equal((source.match(/Main chat: /g) ?? []).length, 1);
});
test("setup pane uses explicit heading, setting and list spacing without an extra section gap", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /setup-settings \{ gap: 0/);
 assert.match(css, /main-chat-setting \{ width: 100%;[^}]*margin-top: 16px/);
 assert.match(css, /your-setups-label \{ margin-top: 24px; margin-bottom: 8px/);
});
