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
  assert.match(css, /height: var\(--composer-height, 120px\)/);
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

test("dark bubbles and disabled send discs use the stronger selected surface", () => {
  assert.match(
    css,
    /\.dark .owner-bubble \{ background: var\(--color-surface-selected\)/,
  );
  assert.match(
    css,
    /\.composer-send:disabled \{\s*background: var\(--color-surface-selected\)/,
  );
});
test("attachments expose the filename below a 72px image in a 96px chip", () => {
  assert.match(read("./image-previews.tsx"), /<figcaption>/);
  assert.match(
    css,
    /draft-images .image-thumbnail \{ width: 96px; height: auto/,
  );
  assert.match(css, /width: 72px; height: 72px; border-radius: 12px/);
  assert.match(
    css,
    /text-overflow: ellipsis; white-space: nowrap; text-align: center/,
  );
});
test("narrow model chip shares the textarea edge and proposal actions share a baseline", () => {
  assert.match(
    css,
    /model-trigger \{ grid-column: 2 \/ 4; justify-self: start; padding-left: 12px/,
  );
  assert.match(
    css,
    /setup-card > div:has\(> .quiet-action\) \{ align-items: center/,
  );
});

test("clearance precedes the scroll anchor and leaves empty chats centred", () => {
  for (const file of ["./app.tsx", "./experiences/view.tsx"]) {
    const source = read(file);
    assert.match(
      source,
      /messages.length\)[\s\S]*?className="transcript-clearance"[\s\S]*?<div ref=\{bottom\}/,
    );
  }
  assert.match(read("./app.tsx"), /const followReply = useRef\(true\)/);
});

test("sidebar header stays out of the narrow title bar", () => {
 assert.match(css, /@media \(max-width: 639px\) \{ .app-bar-side.sidebar-header \{ display: none/);
});
