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
  assert.match(changes, /<h2 id="changes-title"[^>]*>\s*Changes/);
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
  assert.match(read("./app.tsx"), /id="plan-title" aria-label="Account" data-label="Account">Plan/);
  assert.match(read("./app.tsx"), /ChatGPT plan<\/span>[\s\S]*?· Connected/);
  assert.match(read("./managed-settings.tsx"), /Updates Gaia has made to itself. You can undo applied updates here./);
  assert.match(read("./style.css"), /settings-section \+ .settings-section[^}]*border-top: 1px/);
  assert.match(read("./style.css"), /settings-section h2[^}]*var\(--text-headline-medium\)[^}]*font-weight: 600/);
});
