import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { interviewOfferAllowed } from "./experiences/proposal";
import { FailurePath, ReplyNotice } from "./progress-row";
import { MessageMarkdown } from "./transcript";
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
  assert.match(render("new"), />Start the short interview</);
  assert.match(render("new"), />Not now</);
  assert.doesNotMatch(render("skipped"), /Start the short interview|Not now|fit Gaia/);
});
test("transcript clearance keeps final content visible without duplicating the composer height and keeps the short fade", () => {
  assert.match(read("./shared-composer.tsx"), /new ResizeObserver\(measure\)/);
  assert.match(css, /height: 24px/);
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
  assert.match(css, /settings-bar .app-bar-column \{\s*padding-right: var\(--space-gutter\)/);
  assert.match(css, /setup-list-row:has\(> div:last-child:empty\)/);
  assert.match(
    css,
    /settings-content .quiet-action[^}]*text-decoration: none/,
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

test("all conversation shells reveal a 24px top fade and header rule only after scrolling", () => {
  for (const file of ["./app.tsx", "./experiences/view.tsx"]) {
    assert.match(read(file), /el.dataset.scrolled = String\(el.scrollTop > 0\)/);
  }
  assert.match(css, /conversation-scroll\[data-scrolled="true"\][^}]*mask-image: linear-gradient\(transparent, black 24px\)/);
  assert.match(css, /app-shell:has\(.conversation-scroll\[data-scrolled="true"\]\) .app-bar[^}]*inset 0 -1px/);
  assert.match(css, /message-list \{ padding-bottom: 12px/);
  assert.match(read("./app.tsx"), /className="interview-slot"/);
});

test("secondary labels remain readable and errors reserve colour for the icon", () => {
  assert.match(css, /model-trigger:disabled \{\s*opacity: 1/);
  assert.match(css, /model-trigger\[data-loading="true"\] \{ color: var\(--color-ink-2\)/);
  assert.match(css, /reply-error \{ color: var\(--color-ink\)/);
  assert.match(css, /reply-error-icon \{ color: var\(--color-danger\)/);
  assert.match(css, /model-scrim[^}]*color-mix\(in srgb, var\(--color-ink\) 14%, transparent\)/);
});
test("Bot art is clipped to one shared tile radius and welcome lines are balanced", () => {
  assert.match(css, /avatar-tile, .assistant-head .avatar-tile[^}]*border-radius: var\(--radius-sm\); overflow: hidden/);
  assert.match(css, /avatar-tile img \{ border-radius: inherit/);
  assert.match(css, /welcome-intro p \{ text-wrap: balance/);
});
test("composer focus has a single accent edge and both actions share the same fill and shape", () => {
  assert.match(css, /composer:focus-within[^}]*border-color: var\(--color-accent\);\s*box-shadow: none/);
  assert.match(css, /composer-stop \{\s*background: var\(--color-accent\)/);
  assert.match(css, /primary-action, .secondary-action, .quiet-action[^}]*border-radius: var\(--radius-sm\);\s*background-image: none/);
});

test("following survives delayed card and image layout without pulling back a reader who scrolled away", () => {
  const hook = read("./use-transcript-follow.ts");
  assert.match(hook, /if \(follow.current\) bottom.current\?\.scrollIntoView/);
  assert.match(hook, /observer.observe\(content\)/);
  assert.match(hook, /observer.observe\(viewport\)/);
  assert.match(hook, /observer.disconnect\(\)/);
  assert.match(read("./app.tsx"), /useTranscriptFollow\(bottom, followReply/);
  assert.match(read("./experiences/view.tsx"), /useTranscriptFollow\(bottom, follow\)/);
});

 test("answer links keep accent ink, an underline and focus without any button class", () => {
  const html = renderToStaticMarkup(createElement(MessageMarkdown, { text: "Read [the source](https://example.org)." }));
  assert.match(html, /<a href="https:\/\/example.org"[^>]*>the source<\/a>/);
  assert.doesNotMatch(html, /<a[^>]*class="[^"]*(?:action|button)/);
  assert.match(css, /message-markdown a \{[^}]*color: var\(--color-link\);[^}]*text-decoration: underline;[^}]*text-underline-offset: 2px;[^}]*text-decoration-thickness: 1px/);
  assert.match(css, /message-markdown a:hover \{ color: var\(--color-link-hover\)/);
  assert.match(css, /message-markdown a:focus-visible[^}]*outline: 2px solid var\(--color-focus\)/);
  const theme = read("./styles/theme.css");
  assert.match(theme, /--color-link: var\(--color-accent-700\)/);
  assert.match(theme, /--color-link: var\(--color-accent-300\)/);
 });

test("sidebar rows override the shared secondary fill in both themes and tint only interaction or selection", () => {
  assert.match(css, /experience-nav-row.secondary-action \{[^}]*background: transparent;\s*background-image: none/);
  assert.match(css, /experience-nav-row.secondary-action:hover \{\s*background: var\(--color-surface-hover\)/);
  assert.match(css, /experience-nav-row.secondary-action\[aria-current="page"\] \{\s*background: var\(--color-surface-selected\)/);
  assert.doesNotMatch(css, /\.dark \.experience-nav-row/);
  assert.match(css, /experience-nav-row:focus-visible/);
});

test("sentence actions inherit the surrounding size without action button classes", () => {
  for (const Component of [FailurePath, ReplyNotice]) {
    const html = renderToStaticMarkup(createElement(Component, { message: "Gaia couldn’t finish that reply.", onSettings() {} }));
    assert.match(html, /<button class="inline-link">Settings<\/button>/);
    assert.doesNotMatch(html, /quiet-action|quiet-link/);
  }
  assert.match(css, /inline-link \{[^}]*display: inline;[^}]*padding: 0;[^}]*font: inherit/);
});
