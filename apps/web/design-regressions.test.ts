import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { interviewOfferAllowed } from "./experiences/proposal";
import { ProfilePanel } from "./profile-panel";
import type { Experience } from "../../packages/protocol/experiences.ts";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");
const css = read("./style.css");
test("interview waits for proposals to settle and a later answer after any setup card", () => {
  const proposal = {
    kind: "proposed",
    proposal: { answerMessageId: "answer" },
  } as Experience;
  assert.equal(interviewOfferAllowed([], "answer"), true);
  assert.equal(interviewOfferAllowed([proposal], "later"), false);
  for (const item of [
    { ...proposal, kind: "ready" },
    { ...proposal, proposal: { ...proposal.proposal, dismissedAt: "today" } },
    { ...proposal, proposal: { ...proposal.proposal, supersededBy: "other" } },
  ] as Experience[]) {
    assert.equal(interviewOfferAllowed([item], "answer"), false);
    assert.equal(interviewOfferAllowed([item], "later"), true);
  }
});
test("interview offer uses the card frame and skipped interviews stay hidden", () => {
  const render = (kind: "new" | "skipped") =>
    renderToStaticMarkup(
      createElement(ProfilePanel, {
        state: { kind },
        account: false,
        failed: false,
        disabled: false,
        onAction() {},
        onRetry() {},
      }),
    );
  assert.match(render("new"), /setup-card interview-offer/);
  assert.match(render("new"), />Set up</);
  assert.match(render("new"), />Not now</);
  assert.doesNotMatch(render("skipped"), /Set up|Not now|fit Gaia/);
});
test("transcript clearance tracks composer resizing and keeps the short fade", () => {
  assert.match(read("./shared-composer.tsx"), /new ResizeObserver\(measure\)/);
  assert.match(css, /padding-bottom: var\(--composer-height, 120px\)/);
  assert.match(
    css,
    /height: 24px;\s*pointer-events: none;\s*background: linear-gradient/,
  );
  for (const name of ["./app.tsx", "./experiences/view.tsx"]) {
    assert.match(read(name), /conversation-scroll/);
    assert.match(read(name), /scrollIntoView\(\{ block: "end" \}\)/);
  }
});
test("settings hierarchy, actions and status use the content grid", () => {
  assert.match(css, /settings-title \{\s*font-size: 20px/);
  assert.match(css, /settings-bar .app-bar-column \{\s*padding-right: 64px/);
  assert.match(css, /setup-list-row:has\(> div:last-child:empty\)/);
  assert.match(
    css,
    /settings-content .quiet-action[^}]*text-decoration: underline/,
  );
});
test("Gaia artwork has fixed pink and white pixels and is never a theme mask", () => {
  const svg = read("./public/gaia-mark.svg");
  assert.match(svg, /fill="#fa29a0"/);
  assert.match(svg, /fill="white"/);
  assert.doesNotMatch(
    css,
    /mask: url\("\/gaia-mark.svg"\)|gaia-mark \{ background: var/,
  );
});
test("setup shells have a sidebar header and identity-aware placeholder", () => {
  const view = read("./experiences/view.tsx");
  assert.match(view, /app-bar-side sidebar-header/);
  assert.match(view, /`Message #\$\{state\?\.scope.label/);
  assert.match(view, /`Message \$\{state\?\.scope.label/);
  assert.match(css, /desktop-sidebar .drawer-switcher \{\s*display: none/);
});
test("proposal descriptions share fixed grid columns and model separator has no extra space", () => {
  assert.match(css, /grid-template-columns: 92px minmax\(0, 1fr\)/);
  assert.match(
    read("./composer-controls.tsx"),
    /model-trigger-effort">· \{levelText\}/,
  );
});
