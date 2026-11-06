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
test("interview offer shares the proposal frame and skipped interviews stay hidden", () => {
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
  assert.match(render("new"), /class="setup-card interview-offer [^"]*rounded-xl border border-separator-border p-5/);
  assert.match(render("new"), />Start the short interview</);
  const offer = render("new");
  assert.match(offer, /class="setup-card interview-offer [^"]*rounded-xl border border-separator-border p-5/);
  assert.match(offer, /primary-action[^]*Start the short interview/);
  assert.match(offer, /proposal-heading[^]*Fit Gaia around you[^]*status-pill[^]*Suggestion/);
  assert.match(offer, /If you like, I can fit myself around how you work\./);
  assert.doesNotMatch(css, /interview-offer \{/);
  assert.doesNotMatch(css, /interview-offer[^}]*border: 0/);
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
test("Gaia orb, focus and effort selection share the primary accent", () => {
  assert.match(css, /assistant-head \.gaia-mark \{ border-radius: var\(--radius-full\)/);
  assert.match(css, /gaia-mark[^}]*radial-gradient[^}]*var\(--color-primary-fill\)/);
  assert.match(css, /effort-cell\[data-selected\][^}]*background: var\(--color-primary-fill\);[^}]*color: var\(--color-primary-ink\)/);
  const theme = read("./styles/theme.css");
  assert.equal((theme.match(/--color-accent: var\(--color-primary-fill\)/g) ?? []).length, 2);
  assert.equal((theme.match(/--color-focus: var\(--color-primary-fill\)/g) ?? []).length, 2);
});
test("setup shells have a sidebar header and identity-aware placeholder", () => {
  const view = read("./experiences/view.tsx");
  assert.match(view, /app-bar-side sidebar-header/);
  assert.match(view, /"Message Gaia…"/);
  assert.match(view, /`Message \$\{state\?\.scope.label/);
  assert.match(css, /desktop-sidebar .drawer-switcher \{\s*display: none/);
});
test("proposal descriptions share content-sized grid columns and model separator has no extra space", () => {
  assert.match(css, /grid-template-columns: 28px max-content minmax\(0, 1fr\)/);
  assert.match(
    read("./composer-controls.tsx"),
    /model-trigger-separator">\{"\\u2009·\\u2009"\}<\/span>\{levelText\}/,
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
test("narrow model chip shares the add column and proposal actions share a baseline", () => {
  assert.match(
    css,
    /model-trigger \{ grid-column: 1 \/ 4; justify-self: start; padding-left: 10px/,
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

test("all conversation shells cut cleanly at the bar and show a header rule only after scrolling", () => {
  for (const file of ["./app.tsx", "./experiences/view.tsx"]) {
    assert.match(read(file), /el.dataset.scrolled = String\(el.scrollTop > 0\)/);
  }
  assert.doesNotMatch(css, /mask-image/);
  assert.match(css, /app-shell:has\(.conversation-scroll\[data-scrolled="true"\]\) .app-bar[^}]*inset 0 -1px/);
  assert.match(css, /message-list \{ padding-bottom: 12px/);
  assert.match(read("./app.tsx"), /className="interview-slot"/);
});

test("secondary labels remain readable and errors reserve colour for the icon", () => {
  assert.match(css, /model-trigger:disabled \{\s*opacity: 1/);
  assert.match(css, /model-trigger\[data-loading="true"\] \{ color: var\(--color-ink-2\)/);
  assert.match(css, /reply-error \{ color: var\(--color-ink\)/);
  assert.match(css, /reply-error-icon \{ color: var\(--color-danger\)/);
  assert.match(css, /model-scrim[^}]*var\(--backdrop\)/);
});
test("Bot art is clipped to one shared tile radius and welcome lines are balanced", () => {
  assert.match(css, /avatar-tile, .assistant-head .avatar-tile[^}]*border-radius: var\(--radius-sm\); overflow: hidden/);
  assert.match(css, /avatar-tile img \{ border-radius: inherit/);
  assert.match(css, /welcome-intro p \{ text-wrap: balance/);
});
test("composer focus has a neutral edge and Stop keeps the shared shape with a quiet ink fill", () => {
  assert.match(css, /composer:focus-within[^}]*border-color: var\(--color-line-strong\);\s*box-shadow: var\(--shadow-level-1\), 0 0 0 3px/);
  assert.match(css, /composer-send\.composer-stop \{\s*background: var\(--color-ink-2\);\s*color: var\(--color-surface-page\)/);
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
    const html = renderToStaticMarkup(createElement(Component, { message: "Couldn’t finish that reply.", onSettings() {} }));
    assert.match(html, /<button class="inline-link">Settings<\/button>/);
    assert.doesNotMatch(html, /quiet-action|quiet-link/);
  }
  assert.match(css, /inline-link \{[^}]*display: inline;[^}]*padding: 0;[^}]*font: inherit/);
});

test("attachment remove is a backed 24px circle with a 14px icon inside the image", () => {
  const source = read("./image-previews.tsx");
  assert.match(source, /className="remove-image"/);
  assert.doesNotMatch(source, /quiet-action remove-image/);
  assert.match(source, /RiCloseLine className="size-3.5"/);
  assert.match(css, /remove-image \{[^}]*border: 1px solid var\(--color-line\);[^}]*border-radius: 50%;[^}]*background: var\(--color-surface-page\)/);
  assert.match(css, /remove-image \{\s*width: 24px;\s*height: 24px;\s*top: 4px;\s*right: 4px/);
  assert.match(css, /draft-images .remove-image \{ right: 16px/);
});

test("Settings has labelled appearance, contained secondary actions and aligned content controls", () => {
  assert.match(read("./appearance.tsx"), /<label id="theme-label">Theme<\/label>/);
  assert.match(read("./experiences/index.tsx"), /<Button\s*variant="secondary"\s*size="small"/);
  assert.match(read("./managed-settings.tsx"), /className="quiet-action refresh-changes"[^]*aria-label="Refresh changes"/);
  assert.match(css, /settings-section > section > button.primary-action \{ align-self: flex-start/);
  assert.match(css, /settings-bar .app-control:not\(.chat-switcher-trigger\) \{ margin-right: 0/);
});

test("welcome paragraph and action share a measure and omit the repeated connection prompt", () => {
  assert.match(css, /welcome-intro \{ width: 100%; max-width: 320px/);
  assert.match(css, /welcome-intro p \{[^}]*width: 100%; max-width: 320px/);
  assert.match(css, /welcome-composition .welcome-button \{ width: 100%; max-width: 320px/);
  assert.match(read("./app.tsx"), /connection.message !== "Connect your plan to begin."/);
});

test("all shell titles use the primary ink instead of quiet action ink", () => {
  assert.match(css, /app-bar .chat-switcher-trigger \{ color: var\(--color-ink\)/);
  assert.match(css, /scope-head \{[^}]*color: var\(--color-ink\)/);
});

test("setup status uses the shared pill with no dotted status badges", () => {
 assert.match(css, /status-pill \{[^}]*height: 20px/);
 assert.doesNotMatch(css, /setup-status-badge/);
 assert.match(read("./experiences/index.tsx"), /<StatusPill tone="accent">Main chat/);
});

test("overflowing code has top breathing room and a right-edge cue until scrolled to the end", () => {
  assert.match(css, /code-block pre[^}]*padding: 16px/);
  assert.match(css, /data-overflow="true"[^}]*width: 32px[^}]*code-surface\) 80%/);
  assert.match(read("./transcript.tsx"), /scrollWidth - element.clientWidth - element.scrollLeft > 1/);
  assert.match(read("./transcript.tsx"), /removeEventListener\("scroll", measure\)/);
});

test("scrolled transcripts pass under a 32px page gradient with a 16px opaque top in both themes", () => {
 assert.match(css, /app-bar::after \{[^}]*top: 100%;[^}]*height: 32px;[^}]*pointer-events: none;[^}]*linear-gradient\(to bottom, var\(--color-surface-page\) 0px, var\(--color-surface-page\) 16px, transparent 32px\)/);
 assert.doesNotMatch(css, /mask-image|clip-path/);
 assert.match(css, /app-bar.has-side::after \{ left: 240px/);
});

test("settings panes and close control share one measure and account buttons share geometry", () => {
 assert.match(css, /settings-page > .reading-column, .settings-bar .app-bar-column \{ max-width: var\(--column-box\)/);
 assert.doesNotMatch(css, /account-section[^}]*max-width/);
 assert.match(css, /settings-plan-row > div:last-child \{ align-items: center/);
 assert.match(css, /settings-plan-row button \{ height: 28px; min-height: 28px; padding: 4px 8px; border-radius: var\(--radius-sm\)/);
 assert.match(css, /plan-disconnect.quiet-action \{ color: var\(--color-danger\)/);
});

test("model sheets use the light 24 percent and dark 48 percent backdrop tokens directly", () => {
 const theme = read("./styles/theme.css");
 assert.match(theme, /--backdrop: rgb\(0 0 0 \/ 0.24\)/);
 assert.match(theme, /--backdrop: rgb\(0 0 0 \/ 0.48\)/);
 assert.match(css, /model-scrim \{[^}]*background: var\(--backdrop\)/);
 assert.doesNotMatch(css, /color-mix\(in srgb, var\(--backdrop\)/);
});

test("desktop Settings keeps a 560px content measure aligned to the pane gutter", () => {
 assert.match(css, /settings-content \{ width: 100%; max-width: 560px; margin: 0;/);
 const app = read("./app.tsx");
 assert.match(app, /className="settings-page[^]*?<div className="reading-column">\s*<section className="settings-content"/);
 assert.match(app, /<SettingsIndex current=\{settingsSection\}/);
});

test("code headers retain a visible divider in both themes", () => {
 assert.match(css, /\.code-header \{[^}]*border-bottom: 1px solid var\(--color-line-strong\)/);
});
