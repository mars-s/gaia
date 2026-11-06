import { readFileSync } from "node:fs";
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

test("composer keeps attachment growth to its row and aligns narrow model controls with add", () => {
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.match(css, /composer \.draft-images[^}]*padding: 0/);
  assert.match(css, /model-trigger[^}]*grid-column: 1 \/ 4[^}]*padding-left: 10px/);
  assert.match(css, /conversation-scroll[^}]*scrollbar-width: thin; scrollbar-color: transparent transparent/);
  assert.match(css, /conversation-scroll:hover[^}]*scrollbar-color: var\(--color-line-strong\)/);
});

test("composer focus is neutral with a visible halo, shared by both conversations", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /composer:focus-within \{[^}]*border-color: var\(--color-line-strong\)/);
 assert.match(css, /box-shadow: var\(--shadow-level-1\), 0 0 0 3px var\(--color-composer-halo\)/);
 assert.doesNotMatch(css, /composer:focus-within \{[^}]*color-primary-fill/);
 assert.match(css, /composer\.composer-dragging \{ border-color: var\(--color-accent\)/);
 assert.match(css, /dark \.secondary-action \{ border-color: var\(--color-line-strong\)/);
});

test("both themes set a composer halo and share one code block border", () => {
 const theme = readFileSync(new URL("./styles/theme.css", import.meta.url), "utf8");
 assert.equal((theme.match(/--color-composer-halo: color-mix\(in oklab, var\(--color-ink\) 6%, transparent\)/g) ?? []).length, 2);
 assert.doesNotMatch(theme, /--shadow-level-1: none/);
 assert.match(theme, /--shadow-level-1: 0 0 0 transparent/);
 assert.match(theme, /--color-composer-halo: color-mix\(in oklab, var\(--color-ink\) 6%, transparent\)/);
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /\n.code-block \{ border: 1px solid var\(--color-line-strong\)/);
 assert.doesNotMatch(css, /dark \.code-block[^}]*border-color/);
});
