import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfilePanel } from "../../apps/web/profile-panel";

test("Settings has an Account group, clear update copy and separated sections", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
  assert.match(read("../../apps/web/app.tsx"), /id="plan-title">Account/);
  assert.match(read("../../apps/web/app.tsx"), /<PlanAccounts/);

  assert.match(read("../../apps/web/plan-sign-in.tsx"), /connected \? "Connected" : "Not connected"/);
  assert.match(read("../../apps/web/managed-settings.tsx"), /Updates Gaia has made to itself. You can undo applied updates here./);
  assert.match(read("../../apps/web/style.css"), /settings-section \+ .settings-section[^}]*border-top: 1px/);
  assert.match(read("../../apps/web/style.css"), /settings-section h2[^}]*var\(--text-headline-medium\)[^}]*font-weight: 600/);
});
test("Settings interview is secondary and change refresh is an accessible icon action", () => {
  const html = renderToStaticMarkup(createElement(ProfilePanel, {
    state: { kind: "new" }, account: true, failed: false, disabled: false,
    onAction() {}, onRetry() {},
  }));
  assert.match(html, /secondary-action[^]*Start the short interview/);
  assert.doesNotMatch(html, /primary-action/);
  const changes = readFileSync(new URL("../../apps/web/managed-settings.tsx", import.meta.url), "utf8");
  assert.match(changes, /aria-label="Refresh changes"/);
  assert.match(changes, /<RiRefreshLine/);
  const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
  assert.match(css, /settings-content[^}]*gap: 0/);
});
test("narrow account rows stack status and actions, and secondary text shares body tracking", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /settings-plan-row \{ grid-template-columns: 20px minmax\(0, 1fr\);/);
 assert.match(css, /plan-status \{ display: flex; flex-direction: column/);
 assert.match(css, /text-text-secondary[^}]*letter-spacing: 0/);
});
test("Settings hover cannot replace the selected pane fill", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /settings-index button\[aria-current\] \{ background: var\(--color-surface-selected\)/);
 assert.match(css, /settings-index button:not\(\[aria-current\]\):hover/);
 assert.doesNotMatch(css, /settings-index button:hover/);
 });
test("narrow Settings uses a real heading and an accessible listbox switcher", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 const source = readFileSync(new URL("../../apps/web/settings-index.tsx", import.meta.url), "utf8");
 assert.match(css, /settings-index \{ display: none/);
 assert.doesNotMatch(css, /settings-content > .settings-section > h2[^}]*clip: rect/);
 assert.match(source, /<h2 ref=\{heading\} tabIndex=\{-1\} id=\{id\}/);
 assert.match(source, /aria-label=\{`Settings section: /);
 assert.match(source, /aria-haspopup="listbox"/);
 assert.doesNotMatch(source, /tablist/);
});
test("selected Settings labels use primary ink and medium weight at every width", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /\n.settings-index button\[aria-current\] \{ color: var\(--color-ink\); font-weight: 500/);
});
