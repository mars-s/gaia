import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { replyError, ReplyNotice, OfflineNotice } from "./progress-row";

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
      "Gaia couldn’t finish that reply.",
    ],
  ]) {
    assert.equal(replyError(cause), expected);
    const html = renderToStaticMarkup(
      createElement(ReplyNotice, { message: replyError(cause), onRetry() {} }),
    );
    assert.match(html, /reply-error-icon/);
    assert.doesNotMatch(html, /gaia-mark|No reply came back/);
    assert.equal((html.match(/>Try again</g) ?? []).length, 1);
  }
});
test("offline notice keeps the draft reassurance and a separate status dot", () => {
  const html = renderToStaticMarkup(createElement(OfflineNotice));
  assert.match(html, /role="status"/);
  assert.match(
    html,
    /<span aria-hidden="true"><\/span>Offline. Reconnecting… Your draft is safe./,
  );
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
