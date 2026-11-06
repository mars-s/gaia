import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaudeSignIn, PlanAccounts } from "./plan-sign-in";

test("Claude welcome action renders the matching social button", () => {
  const html = renderToStaticMarkup(
    createElement(ClaudeSignIn, { disabled: false, onConnect() {} }),
  );
  assert.match(html, /Continue with Claude/);
  assert.match(html, /welcome-button/);
  assert.doesNotMatch(html, /disabled=""/);
});
for (const connected of ["openai-codex", "anthropic", "both"] as const) {
  test(`Account renders each plan independently with ${connected} connected`, () => {
    const html = renderToStaticMarkup(
      createElement(PlanAccounts, {
        connection: {
          kind: "connected",
          model: "synthetic",
          plans: [
            { provider: "openai-codex", connected: connected !== "anthropic" },
            { provider: "anthropic", connected: connected !== "openai-codex" },
          ],
        },
        disabled: false,
        onConnect() {},
      }),
    );
    assert.match(html, /ChatGPT plan/);
    assert.match(html, /Claude plan/);
    assert.equal(
      (html.match(/>Reconnect</g) ?? []).length,
      connected === "both" ? 2 : 1,
    );
    assert.equal(
      (html.match(/>Connect</g) ?? []).length,
      connected === "both" ? 0 : 1,
    );
  });
}
