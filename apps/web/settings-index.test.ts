import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsIndex, SettingsHeading, settingsSections } from "./settings-index.tsx";

function referencesResolve(html: string) {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
  for (const match of html.matchAll(/\saria-(?:controls|labelledby)="([^"]+)"/g))
    for (const id of match[1].split(/\s+/)) assert(ids.has(id), `Missing ARIA target: ${id}`);
}
for (const theme of ["light", "dark"])
  for (const [current, label] of settingsSections)
    test(`Settings ARIA targets resolve with only ${label} mounted in ${theme}`, () => {
      const html = renderToStaticMarkup(createElement("div", { className: theme },
        createElement(SettingsIndex, { current, onSelect() {} }),
        createElement("section", { "aria-labelledby": current },
          createElement(SettingsHeading, { id: current, children: label }))));
      referencesResolve(html);
      assert.match(html, /aria-current="page"/);
      assert.throws(() => referencesResolve(html.replace('aria-current="page"', 'aria-controls="missing-pane"')), /Missing ARIA target/);
    });
