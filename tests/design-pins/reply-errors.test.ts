import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { replyError, ReplyNotice } from "../../apps/web/progress-row";
test("reply error retry and helper use the same text edge at every width", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /reply-error \{ display: flex; flex-direction: column; align-items: flex-start/);
 assert.match(css, /reply-error > button:not\(.inline-link\) \{ margin-left: 0/);
 assert.match(css, /reply-notice \.failure-path \{ margin-left: 0/);
 assert.match(css, /reply-error-icon \{ display: inline-block;[^}]*width: 16px; height: 16px/);
});
test("unknown errors avoid repeating the turn identity and balance spacing around retry", () => {
 const html = renderToStaticMarkup(createElement(ReplyNotice, {message: replyError("unexpected"), onRetry() {}, onSettings() {}}));
 assert.match(html, /Couldn’t finish that reply\./);
 assert.doesNotMatch(html, /Gaia couldn/);
 assert.match(html, /Couldn’t finish[^]*Try again[^]*failure-path/);
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /reply-error \{[^}]*gap: 8px/);
 assert.match(css, /reply-notice .failure-path \{[^}]*margin-top: 8px/);
});
test("known reply causes get one useful sentence and unknown failures stay plain", () => {
  for (const [cause, expected] of [
    ["Provider disconnected.", "Connection lost."],
    ["fetch failed", "Connection lost."],
    [
      "Authentication token expired",
      "Your plan sign-in needs renewing. Reconnect in Settings.",
    ],
    [
      "401 Unauthorized",
      "Your plan sign-in needs renewing. Reconnect in Settings.",
    ],
    [
      "Model unavailable",
      "That model isn’t available now. Choose another to send.",
    ],
    [
      "Unknown model: old",
      "That model isn’t available now. Choose another to send.",
    ],
    [
      "The reply could not finish. Try again when ready.",
      "Couldn’t finish that reply.",
    ],
  ]) {
    assert.equal(replyError(cause), expected);
    const html = renderToStaticMarkup(
      createElement(ReplyNotice, { message: replyError(cause), onRetry() {} }),
    );
    assert.match(html, /class="error-message"><svg[^]*reply-error-icon/);
    assert.doesNotMatch(html, /gaia-mark|No reply came back/);
    assert.equal((html.match(/>Try again</g) ?? []).length, 1);
  }
});
test("failure second paths offer Settings for unknown causes and reconnection advice for a lost connection", () => {
  const unknown = renderToStaticMarkup(
    createElement(ReplyNotice, {
      message: replyError("unexpected"),
      onSettings() {},
    }),
  );
  assert.match(unknown, /If this keeps happening, check your plan in/);
  assert.match(unknown, /class="inline-link">Settings<\/button>/);
  const offline = renderToStaticMarkup(
    createElement(ReplyNotice, { message: replyError("fetch failed") }),
  );
  assert.match(offline, /Try again once you’re back online./);
  for (const message of [
    "Stopped.",
    replyError("Model unavailable"),
    replyError("401"),
  ]) {
    const html = renderToStaticMarkup(createElement(ReplyNotice, { message }));
    assert.doesNotMatch(html, /failure-path/);
  }
});
