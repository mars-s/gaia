import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerControls, EffortControls } from "./composer-controls.tsx";
import { modelMenu, readRecentModels, rememberModel } from "./recent-models.ts";

const models = [
  "Zeta 1",
  "Custom",
  "Unknown local",
  "Alpha",
  "B",
  "C",
  "D",
  "E",
].map((name) => ({ id: name, name, contextWindow: 1000 }));

test("an unavailable stored effort offers only current supported choices without switching automatically", () => {
  const html = renderToStaticMarkup(
    createElement(EffortControls, {
      model: {
        id: "test",
        name: "Test",
        contextWindow: 1000,
        capabilities: { images: true, thinkingLevels: ["low", "medium"] },
      },
      disabled: false,
      onSelect() {
        assert.fail("Rendering must not change the effort");
      },
    }),
  );
  assert.match(html, /Choose one/);
  assert.match(html, /Low/);
  assert.match(html, /Medium/);
  assert.doesNotMatch(html, /High|Max|no adjustable reasoning/);
});

test("small catalogues preserve Pi order including an unavailable current selection", () => {
  const small = models.slice(0, 6);
  assert.deepEqual(modelMenu(small, "Custom", ["Alpha"]).primary, small);
  const removed = modelMenu(small, "Removed", ["Alpha"]);
  assert.deepEqual(
    removed.primary.map((m) => m.id),
    ["Removed", ...small.map((m) => m.id)],
  );
  assert.deepEqual(removed.remaining, []);
});

test("long catalogues keep the current choice and three genuine picks, with every remaining model in Pi order", () => {
  const menu = modelMenu(models, "Custom", [
    "Alpha",
    "Alpha",
    "Removed",
    "E",
    "Custom",
    "B",
    "C",
  ]);
  assert.deepEqual(
    menu.primary.map((m) => m.id),
    ["Custom", "Alpha", "B", "E"],
  );
  assert.deepEqual(
    menu.remaining.map((m) => m.id),
    ["Zeta 1", "Unknown local", "C", "D"],
  );
  const all = [...menu.primary, ...menu.remaining].map((m) => m.id);
  assert.equal(new Set(all).size, models.length);
  assert.deepEqual(new Set(all), new Set(models.map((m) => m.id)));
  assert.deepEqual(
    modelMenu(models, "Unknown local", []).primary.map((m) => m.id),
    ["Unknown local"],
  );
  assert.deepEqual(modelMenu(models, "Removed", []).remaining, models);
});

test("recent history records actual picks, survives reopening and tolerates invalid or blocked device storage", () => {
  let value: string | null = null;
  const storage = () => ({
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  });
  assert.deepEqual(readRecentModels(storage), []);
  let recent: string[] = [];
  for (const id of ["Zeta 1", "Custom", "Alpha", "B", "Custom"])
    recent = rememberModel(id, recent, storage);
  assert.deepEqual(readRecentModels(storage), [
    "Custom",
    "B",
    "Alpha",
    "Zeta 1",
  ]);
  value = '["Custom", "Custom", "Zeta 1"]';
  assert.deepEqual(readRecentModels(storage), ["Custom", "Zeta 1"]);
  for (const invalid of ['{"x":1}', "[1]", "broken"]) {
    value = invalid;
    assert.deepEqual(readRecentModels(storage), []);
  }
  const blocked = () => {
    throw new Error("Storage denied");
  };
  assert.deepEqual(readRecentModels(blocked), []);
  assert.deepEqual(rememberModel("Custom", ["Alpha"], blocked), [
    "Custom",
    "Alpha",
  ]);
});

test("the removed selection stays visible in the composer trigger", () => {
  const html = renderToStaticMarkup(
    createElement(ComposerControls, {
      chat: { modelId: "Removed", models, compaction: { kind: "idle" } },
      disabled: false,
      onSelect() {
        assert.fail("Rendering must not switch model");
      },
    }),
  );
  assert.match(html, /Removed/);
  assert.match(html, /Not available now/);
});

test("context token counts use compact real capability values", async () => {
  const { contextCount } = await import("./composer-controls.tsx");
  for (const [count, expected] of [
    [800, "800"],
    [128000, "128k"],
    [272000, "272k"],
    [500000, "500k"],
    [1000000, "1M"],
    [1500000, "1.5M"],
  ] as const)
    assert.equal(contextCount(count), expected);
});

test("model facts include only supported facts and explain image incompatibility", async () => {
  const { modelFacts } = await import("./composer-controls.tsx");
  const model = {
    id: "sol",
    name: "Sol",
    contextWindow: 500000,
    capabilities: { images: true, thinkingLevels: [] },
  };
  assert.equal(modelFacts(model, false), "Reads images\u202f·\u202f500k context");
  model.capabilities.images = false;
  assert.equal(modelFacts(model, false), "Text only\u202f·\u202f500k context");
  assert.equal(
    modelFacts(model, true),
    "Can’t read your images\u202f·\u202f500k context",
  );
  assert.equal(
    modelFacts({ id: "legacy", name: "Legacy", contextWindow: 1 }, false),
    undefined,
  );
});

test("trigger effort reflects supported, fixed, unsupported and unavailable selections", async () => {
  const { effortText } = await import("./composer-controls.tsx");
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

test("thresholds, catalogue order and id search stay faithful to the provider", async () => {
  const { filterModels } = await import("./composer-controls.tsx");
  const catalogue = Array.from({ length: 40 }, (_, i) => ({
    id: `raw-${i}`,
    name: `Model ${i}`,
    contextWindow: 1000,
  }));
  for (const count of [2, 6])
    assert.equal(
      modelMenu(catalogue.slice(0, count), "raw-0", []).remaining.length,
      0,
    );
  for (const count of [7, 12, 13, 40])
    assert.equal(
      modelMenu(catalogue.slice(0, count), "raw-0", []).remaining.length,
      count - 1,
    );
  assert.deepEqual(
    filterModels(catalogue, "MODEL 1").map((model) => model.id),
    ["raw-1", ...Array.from({ length: 10 }, (_, i) => `raw-${i + 10}`)],
  );
  assert.deepEqual(
    filterModels(catalogue, "RAW-23").map((model) => model.id),
    ["raw-23"],
  );
  assert.deepEqual(filterModels(catalogue, "missing"), []);
});

test("real Pi effort cells render in registry order with Medium selected and never mutate on render", async () => {
  const { openaiCodexProvider } =
    await import("@earendil-works/pi-ai/providers/openai-codex");
  const { effortLevels } = await import("../server/model-effort.ts");
  const { EffortControls } = await import("./composer-controls.tsx");
  const real = openaiCodexProvider()
    .getModels()
    .find((model) => model.id === "gpt-6.1-sol");
  assert.ok(real);
  const levels = effortLevels(real);
  assert.deepEqual(levels, ["low", "medium", "high", "xhigh", "max"]);
  const html = renderToStaticMarkup(
    createElement(EffortControls, {
      model: {
        id: real.id,
        name: real.name,
        contextWindow: real.contextWindow,
        capabilities: { images: true, thinkingLevels: levels },
      },
      level: "medium",
      disabled: false,
      onSelect() {
        assert.fail("Render changed effort");
      },
    }),
  );
  assert.equal((html.match(/type="radio"/g) ?? []).length, 5);
  assert.equal((html.match(/checked=""/g) ?? []).length, 1);
  assert.equal((html.match(/data-selected="true"/g) ?? []).length, 1);
  let last = -1;
  for (const name of ["Low", "Medium", "High", "Extra high", "Max"]) {
    const index = html.indexOf(`>${name}<`, last + 1);
    assert.ok(index > last);
    last = index;
  }
});

test("model facts disappear for identical choices, differ when useful and always warn about draft images", async () => {
  const { modelChoiceFacts } = await import("./composer-controls.tsx");
  const sol = {
    id: "sol",
    name: "Sol",
    contextWindow: 500000,
    capabilities: { images: true, thinkingLevels: [] },
  };
  const terra = { ...sol, id: "terra", name: "Terra" };
  assert.equal(modelChoiceFacts(sol, [sol, terra], false), undefined);
  const smaller = { ...terra, contextWindow: 128000 };
  assert.equal(
    modelChoiceFacts(sol, [sol, smaller], false),
    "Reads images\u202f·\u202f500k context",
  );
  assert.equal(
    modelChoiceFacts(smaller, [sol, smaller], false),
    "Reads images\u202f·\u202f128k context",
  );
  const text = { ...sol, capabilities: { ...sol.capabilities, images: false } };
  assert.equal(
    modelChoiceFacts(text, [text], true),
    "Can’t read your images\u202f·\u202f500k context",
  );
  assert.equal(
    modelChoiceFacts(sol, [sol, text], false),
    "Reads images\u202f·\u202f500k context",
  );
});

test("mobile model Done is a secondary action with a safe bottom inset", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./composer-controls.tsx", import.meta.url), "utf8");
  assert.match(source, /className="secondary-action model-done"/);
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  assert.ok(css.includes("32px + env(safe-area-inset-bottom)"));
  assert.match(css, /model-done[^}]*min-height: 32px[^}]*color: var\(--color-ink\)/);
});

test("model sheet dims with the shared backdrop and radios keep one centre token in both themes", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /model-scrim \{[^}]*background: var\(--backdrop\)/);
 assert.match(css, /data-selected\] > \.model-radio \{[^}]*background: var\(--color-primary-ink\)/);
});

 test("effort names its selected value only in its segment", () => {
 const html = renderToStaticMarkup(createElement(EffortControls, {
 model: { id: "test", name: "Test", contextWindow: 1000, capabilities: { images: true, thinkingLevels: ["low", "medium", "high"] } },
 level: "medium", disabled: false, onSelect() {},
 }));
 assert.equal((html.match(/>Medium</g) ?? []).length, 1);
 assert.match(html, /effort-header[^]*?<span>Effort<\/span>\s*<\/p>/);
 assert.match(html, /data-selected/);
 });

test("narrow sheets dim through theme backdrop tokens and reserve safe bottom space", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /model-scrim[^}]*background: var\(--backdrop\)/);
 assert.match(css, /model-sheet \{[^}]*padding: 0 16px calc\(32px \+ env\(safe-area-inset-bottom\)\)/);
 assert.match(css, /max-height: calc\(80dvh - 32px - env\(safe-area-inset-bottom\)\)/);
 assert.doesNotMatch(css, /dark .model-scrim/);
});

test("model rows select through the radio alone and effort captions follow the segments", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.doesNotMatch(css, /\.model-option\[data-selected\][^{]*\{[^}]*background:/);
 const html = renderToStaticMarkup(createElement(EffortControls, {
 model: {id: "test", name: "Test", contextWindow: 1000, capabilities: {images: true, thinkingLevels: ["low", "high"]}},
 level: "low", disabled: false, onSelect() {},
 }));
 assert.match(html, /effort-header[^]*Effort[^]*effort-segments[^]*effort-ends[^]*Faster[^]*Smarter/);
 assert.match(css, /effort-ends \{[^}]*font-size: 12px/);
});
