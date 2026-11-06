import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfilePanel } from "./profile-panel";

test("Settings has its own header, close control and five peer sections in order", () => {
  const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
  assert.match(
    app,
    /accountOpen \? \([\s\S]*?>Settings<\/span>[\s\S]*?: connected/,
  );
  assert.match(app, /accountOpen \? "Close settings"/);
  const page = app.slice(app.indexOf('id="account-settings"'));
  assert.doesNotMatch(page.slice(0, page.indexOf(") : !state")), /<h1/);
  const positions = [
    'id="plan-title"',
    'id="appearance-title"',
    "<SetupSettings",
    'id="about-title"',
    "<ManagedSettings",
  ].map((s) => page.indexOf(s));
  assert(
    positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])),
  );
  const changes = readFileSync(
    new URL("./managed-settings.tsx", import.meta.url),
    "utf8",
  );
  assert.match(changes, /<SettingsHeading id="changes-title">Change history/);
});

test("Settings folds the interview offer into About you without a Skip action", () => {
  for (const kind of ["new", "skipped"] as const) {
    const html = renderToStaticMarkup(
      createElement(ProfilePanel, {
        state: { kind },
        failed: false,
        account: true,
        disabled: false,
        onAction() {},
        onRetry() {},
      }),
    );
    assert.match(html, /Start the short interview/);
    assert.doesNotMatch(html, />Skip(?: interview)?</);
    assert.match(
      html,
      kind === "new"
        ? /Tell Gaia a little about yourself/
        : /You skipped the short interview/,
    );
  }
});

test("Settings has an Account group, clear update copy and separated sections", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
  assert.match(read("./app.tsx"), /id="plan-title">Account/);
  assert.match(read("./app.tsx"), /<PlanAccounts/);

  assert.match(read("./plan-sign-in.tsx"), /connected \? "Connected" : "Not connected"/);
  assert.match(read("./managed-settings.tsx"), /Updates Gaia has made to itself. You can undo applied updates here./);
  assert.match(read("./style.css"), /settings-section \+ .settings-section[^}]*border-top: 1px/);
  assert.match(read("./style.css"), /settings-section h2[^}]*var\(--text-headline-medium\)[^}]*font-weight: 600/);
});

test("Settings interview is secondary and change refresh is an accessible icon action", () => {
  const html = renderToStaticMarkup(createElement(ProfilePanel, {
    state: { kind: "new" }, account: true, failed: false, disabled: false,
    onAction() {}, onRetry() {},
  }));
  assert.match(html, /secondary-action[^]*Start the short interview/);
  assert.doesNotMatch(html, /primary-action/);
  const changes = readFileSync(new URL("./managed-settings.tsx", import.meta.url), "utf8");
  assert.match(changes, /aria-label="Refresh changes"/);
  assert.match(changes, /<RiRefreshLine/);
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /settings-content[^}]*gap: 0/);
});

import { SettingsHeading, SettingsIndex, settingsSections } from "./settings-index";
test("Settings navigation selects exactly one pane and retains five owner choices", () => {
 for (const [current] of settingsSections) {
  const html = renderToStaticMarkup(createElement(SettingsIndex, { current, onSelect() {} }));
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(html, new RegExp('aria-current="page" aria-controls="' + current + '"'));
  assert.match(html, /Settings sections/);
  assert.doesNotMatch(html, /combobox|settings-picker/);
  assert.equal((html.match(/<button/g) ?? []).length, 5);
 }
 const source = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
 for (const [id] of settingsSections) assert.ok(source.includes('settingsSection === "' + id + '"'));
 assert.match(source, /document.getElementById\(section\)\?\.focus/);
 assert.match(source, /setSettingsSection\("setups-title"\)/);
});

test("narrow account rows stack status and actions, and secondary text shares body tracking", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /settings-plan-row \{ grid-template-columns: 20px minmax\(0, 1fr\);/);
 assert.match(css, /plan-status \{ display: flex; flex-direction: column/);
 assert.match(css, /text-text-secondary[^}]*letter-spacing: 0/);
});

 test("Settings hover cannot replace the selected pane fill", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /settings-index button\[aria-current\] \{ background: var\(--color-surface-selected\)/);
 assert.match(css, /settings-index button:not\(\[aria-current\]\):hover/);
 assert.doesNotMatch(css, /settings-index button:hover/);
 });

test("settings use main chat consistently and explain change history truthfully", () => {
 const setups = readFileSync(new URL("./experiences/index.tsx", import.meta.url), "utf8");
 assert.match(setups, /Opens when Gaia starts\./);
 assert.doesNotMatch(setups, /main setup|>Main</);
 const history = readFileSync(new URL("./managed-settings.tsx", import.meta.url), "utf8");
 assert.match(history, />Change history</);
 assert.match(history, /Updates Gaia has made to itself/);
 const nav = readFileSync(new URL("./settings-index.tsx", import.meta.url), "utf8");
 assert.match(nav, /"Change history"/);
});

test("narrow Settings uses a real heading and an accessible listbox switcher", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 const source = readFileSync(new URL("./settings-index.tsx", import.meta.url), "utf8");
 assert.match(css, /settings-index \{ display: none/);
 assert.doesNotMatch(css, /settings-content > .settings-section > h2[^}]*clip: rect/);
 assert.match(source, /<h2 ref=\{heading\} tabIndex=\{-1\} id=\{id\}/);
 assert.match(source, /aria-label=\{`Settings section: /);
 assert.match(source, /aria-haspopup="listbox"/);
 assert.doesNotMatch(source, /tablist/);
});

test("selected Settings labels use primary ink and medium weight at every width", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /\n.settings-index button\[aria-current\] \{ color: var\(--color-ink\); font-weight: 500/);
});

test("narrow heading keeps the exact section name independently of its button name", () => {
 for (const [id, label] of settingsSections) {
  const html = renderToStaticMarkup(createElement(SettingsHeading, { id, children: label }));
  assert.match(html, new RegExp(`<h2[^>]*aria-label="${label}"`));
  assert.match(html, new RegExp(`<button[^>]*role="button"[^>]*aria-label="Settings section: ${label}"`));
 }
});
