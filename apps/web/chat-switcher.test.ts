import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatSwitcher } from "./chat-switcher";
import { Experience } from "../../packages/protocol/experiences";

const profile = Experience.parse({
  id: "11111111-1111-4111-8111-111111111111",
  revision: 1,
  kind: "ready",
  plan: {
    layout: "bots",
    title: "Everyday Bots",
    assistantName: "Gaia",
    purpose: "Test",
    scopes: [{ label: "Home", purpose: "Test" }],
  },
});

test("without ready setups the title is Original chat without a menu or chevron", () => {
  const html = renderToStaticMarkup(
    createElement(ChatSwitcher, {
      profiles: [],
      currentId: null,
      mainId: null,
      onSelect: () => assert.fail("Must not navigate"),
    }),
  );
  assert.match(html, />Original chat</);
  assert.doesNotMatch(html, /button|svg|details|summary/);
});

test("ready setups get a named Base UI menu trigger with the current chat title", () => {
  for (const currentId of [null, profile.id]) {
    const html = renderToStaticMarkup(
      createElement(ChatSwitcher, {
        profiles: [profile],
        currentId,
        mainId: profile.id,
        onSelect: () => assert.fail("Rendering must not navigate"),
      }),
    );
    assert.match(html, /aria-label="Switch chat"/);
    assert.match(html, /aria-haspopup="menu"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, currentId ? />Everyday Bots</ : />Original chat</);
    assert.doesNotMatch(html, /details|summary|Make main/);
  }
});
