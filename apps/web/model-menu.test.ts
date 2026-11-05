import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComposerControls } from "./composer-controls.tsx";
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
    ["Custom", "Alpha", "E", "B"],
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
