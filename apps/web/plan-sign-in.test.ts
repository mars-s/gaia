import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ClaudeSignIn,
  PlanAccounts,
  disconnectWithConfirmation,
} from "./plan-sign-in";

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
        onDisconnect() {},
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

for (const provider of ["anthropic", "openai-codex"] as const) {
  test(`disconnect ${provider} requires confirmation and targets that plan only`, () => {
    const calls: string[] = [];
    disconnectWithConfirmation(
      provider,
      () => false,
      (value) => calls.push(value),
    );
    assert.equal(calls.length, 0);
    disconnectWithConfirmation(
      provider,
      (message) => {
        assert.match(message, provider === "anthropic" ? /Claude/ : /ChatGPT/);
        assert.match(message, /saved sign-in/);
        return true;
      },
      (value) => calls.push(value),
    );
    assert.deepEqual(calls, [provider]);
  });
}
test("Account shows a failed Claude sign-in beside a connected ChatGPT plan", () => {
  const html = renderToStaticMarkup(
    createElement(PlanAccounts, {
      connection: {
        kind: "connected",
        model: "gpt-6.1-sol",
        plans: [
          { provider: "openai-codex", connected: true },
          {
            provider: "anthropic",
            connected: false,
            error: "Claude sign-in did not complete. Try connecting again.",
          },
        ],
      },
      disabled: false,
      onConnect() {},
      onDisconnect() {},
    }),
  );
  assert.match(html, /role="alert"[^]*Claude sign-in did not complete/);
  assert.match(html, /aria-label="Disconnect ChatGPT plan"/);
  assert.doesNotMatch(html, /aria-label="Disconnect Claude plan"/);
});
