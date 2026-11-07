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
  assert.match(render("new"), /aria-label="Start the short interview"/);
  const offer = render("new");
  assert.match(offer, /primary-action[^]*Start the short interview/);
  assert.match(offer, /proposal-heading[^]*Fit Gaia around you[^]*status-pill[^]*Optional/);
  assert.match(offer, /Answer three quick questions and Gaia will shape itself around how you work\./);
  assert.match(render("new"), />Not now</);
  assert.doesNotMatch(render("skipped"), /Start the short interview|Not now|fit Gaia/);
});
test("transcript clearance keeps final content visible without duplicating the composer height and keeps the short fade", () => {
  assert.match(read("./shared-composer.tsx"), /new ResizeObserver\(measure\)/);
  for (const name of ["./app.tsx", "./experiences/view.tsx"]) {
    assert.match(read(name), /conversation-scroll/);
    assert.match(read(name), /scrollIntoView\(\{ block: "end" \}\)/);
  }
});
test("setup shells have a sidebar header and identity-aware placeholder", () => {
  const view = read("./experiences/view.tsx");
  assert.match(view, /app-bar-side sidebar-header/);
  assert.match(view, /"Message Gaia…"/);
  assert.match(view, /`Message \$\{state\?\.scope.label/);
});
test("proposal descriptions share content-sized grid columns and model separator has no extra space", () => {
  assert.match(
    read("./composer-controls.tsx"),
    /model-trigger-separator">\{"\\u2009·\\u2009"\}<\/span>\{levelText\}/,
  );
});
test("draft attachment chips keep filename, type and a separate removal action", () => {
 const preview = read("./image-previews.tsx");
 assert.match(preview, /draft-file-copy/);
 assert.match(preview, /PNG image/);
 assert.match(preview, /!remove && <figcaption>/);
});

test("clearance precedes the scroll anchor and leaves empty chats centred", () => {

  assert.match(read("./app.tsx"), /const followReply = useRef\(true\)/);
});

test("all conversation shells cut cleanly at the bar and show a header rule only after scrolling", () => {
  for (const file of ["./app.tsx", "./experiences/view.tsx"]) {
    assert.match(read(file), /el.dataset.scrolled = String\(el.scrollTop > 0\)/);
  }
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
 });

test("sentence actions inherit the surrounding size without action button classes", () => {
  for (const Component of [FailurePath, ReplyNotice]) {
    const html = renderToStaticMarkup(createElement(Component, { message: "Couldn’t finish that reply.", onSettings() {} }));
    assert.doesNotMatch(html, /quiet-action|quiet-link/);
  }
});

test("attachment remove is a backed 24px circle with a 14px icon inside the image", () => {
  const source = read("./image-previews.tsx");
  assert.doesNotMatch(source, /quiet-action remove-image/);
});

test("Settings has labelled appearance, contained secondary actions and aligned content controls", () => {
  assert.match(read("./appearance.tsx"), /<label id="theme-label">Theme<\/label>/);
  assert.match(read("./experiences/index.tsx"), /<Button\s*variant="secondary"\s*size="small"/);
  assert.match(read("./managed-settings.tsx"), /className="quiet-action refresh-changes"[^]*aria-label="Refresh changes"/);
});

test("welcome paragraph and action share a measure and omit the repeated connection prompt", () => {
  assert.match(read("./app.tsx"), /connection.message !== "Connect your plan to begin."/);
});

test("setup status uses the shared pill with no dotted status badges", () => {
 assert.match(read("./experiences/index.tsx"), /<StatusPill tone="accent">Main chat/);
});

test("overflowing code has top breathing room and a right-edge cue until scrolled to the end", () => {
  assert.match(read("./transcript.tsx"), /scrollWidth - element.clientWidth - element.scrollLeft > 1/);
  assert.match(read("./transcript.tsx"), /removeEventListener\("scroll", measure\)/);
});

test("desktop Settings keeps a 560px content measure aligned to the pane gutter", () => {
 const app = read("./app.tsx");
 assert.match(app, /<SettingsIndex current=\{settingsSection\}/);
});
