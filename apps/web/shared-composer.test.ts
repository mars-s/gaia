import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SharedComposer } from "./shared-composer";
import { homeSnapshot } from "./conversation-fixtures";

const props = {
  label: "Message Gaia",
  placeholder: "Message Gaia…",
  draft: "",
  images: [],
  ready: true,
  supportsImages: true,
  actionsDisabled: false,
  modelDisabled: false,
  canSend: false,
  chat: homeSnapshot().chat,
  onChange() {},
  onRemove() {},
  onImages() {},
  onCompose() {},
  onCompact() {},
  onSelect() {},
  onSend() {},
};
test("shared composer keeps draft, attachment, model and cancellation controls in one form", () => {
  for (const state of [
    {},
    { draft: "Hello", canSend: true },
    { onStop() {} },
    {
      images: [
        {
          id: "image",
          name: "Plan.png",
          mimeType: "image/png" as const,
          data: "YWJj",
        },
      ],
    },
  ]) {
    const html = renderToStaticMarkup(
      createElement(SharedComposer, { ...props, ...state }),
    );
    assert.equal((html.match(/<form/g) ?? []).length, 1);
    assert.match(html, /class="composer flex flex-col gap-2 p-2"/);
    assert.match(html, /Chat actions/);
    assert.match(html, /Home model/);
    assert.match(html, /Message Gaia…/);
    assert.doesNotMatch(html, /autofocus|bg-accent-500/);
    assert.match(html, /aria-label="Choose images"/);
    if ("images" in state) assert.match(html, /Remove Plan.png/);
    if ("onStop" in state)
      assert.match(html, /composer-stop[^>]*[\s\S]*aria-label="Stop reply"/);
  }
});
