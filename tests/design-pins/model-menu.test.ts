import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerControls, EffortControls } from "../../apps/web/composer-controls.tsx";

test("mobile model Done is a secondary action with a safe bottom inset", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../apps/web/composer-controls.tsx", import.meta.url), "utf8");
  assert.match(source, /className="secondary-action model-done"/);
  const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
  assert.ok(css.includes("32px + env(safe-area-inset-bottom)"));
  assert.match(css, /model-done[^}]*min-height: 32px[^}]*color: var\(--color-ink\)/);
});
test("model sheet dims with the shared backdrop and radios keep one centre token in both themes", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /model-scrim \{[^}]*background: var\(--backdrop\)/);
 assert.match(css, /data-selected\] > \.model-radio \{[^}]*background: var\(--color-primary-ink\)/);
});
test("narrow sheets dim through theme backdrop tokens and reserve safe bottom space", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.match(css, /model-scrim[^}]*background: var\(--backdrop\)/);
 assert.match(css, /model-sheet \{[^}]*padding: 0 16px calc\(32px \+ env\(safe-area-inset-bottom\)\)/);
 assert.match(css, /max-height: calc\(80dvh - 32px - env\(safe-area-inset-bottom\)\)/);
 assert.doesNotMatch(css, /dark .model-scrim/);
});
test("model rows select through the radio alone and effort captions follow the segments", () => {
 const css = readFileSync(new URL("../../apps/web/style.css", import.meta.url), "utf8");
 assert.doesNotMatch(css, /\.model-option\[data-selected\][^{]*\{[^}]*background:/);
 const html = renderToStaticMarkup(createElement(EffortControls, {
 model: {id: "test", name: "Test", contextWindow: 1000, capabilities: {images: true, thinkingLevels: ["low", "high"]}},
 level: "low", disabled: false, onSelect() {},
 }));
 assert.match(html, /effort-header[^]*Effort[^]*effort-segments[^]*effort-ends[^]*Faster[^]*Smarter/);
 assert.match(css, /effort-ends \{[^}]*font-size: 12px/);
});
test("trigger effort reflects supported, fixed, unsupported and unavailable selections", async () => {
  const { effortText } = await import("../../apps/web/composer-controls.tsx");
  const model = {
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    contextWindow: 500000,
    capabilities: {
      images: true,
      thinkingLevels: ["low", "medium", "high", "xhigh", "max"] as const,
    },
  };
  const mutable = {
    ...model,
    capabilities: {
      ...model.capabilities,
      thinkingLevels: [...model.capabilities.thinkingLevels],
    },
  };
  for (const [level, text] of [
    ["medium", "Medium"],
    ["off", "Choose effort"],
  ] as const) {
    assert.equal(effortText(mutable, level), text);
    const html = renderToStaticMarkup(
      createElement(ComposerControls, {
        chat: {
          models: [mutable],
          modelId: model.id,
          thinkingLevel: level,
          compaction: { kind: "idle" },
        },
        disabled: false,
        onSelect() {
          assert.fail("Render selected");
        },
      }),
    );
    assert.match(html, new RegExp(`model-trigger-effort"><span class="model-trigger-separator">\u2009·\u2009</span>${text}`));
    assert.match(html, /GPT-6.1 Sol/);
  }
  assert.equal(
    effortText(
      { ...mutable, capabilities: { images: true, thinkingLevels: [] } },
      "medium",
    ),
    undefined,
  );
  assert.equal(
    effortText(
      { ...mutable, capabilities: { images: true, thinkingLevels: ["high"] } },
      "high",
    ),
    undefined,
  );
  assert.equal(effortText(undefined, "high"), "Not available now");
});
