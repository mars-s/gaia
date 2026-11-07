import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Action, EmptyState, Loading, Notice, Preview, usePreviewState } from "./ui";

function Surface() {
  const state = usePreviewState("ready");
  if (state === "empty") return createElement(EmptyState, { glyph: "", text: "No tasks yet." });
  if (state === "loading") return createElement(Loading);
  if (state === "error") return createElement(Notice, { tone: "danger", message: "Connection lost." });
  return createElement(Action, { variant: "primary" }, "Add task");
}
test("a preview overrides a ready surface with each required state without changing its actual state", () => {
  for (const [state, marker] of [["empty", "empty-state"], ["loading", "loading"], ["error", "notice"]] as const) {
    const html = renderToStaticMarkup(createElement(Preview, { state, children: createElement(Surface) }));
    assert.match(html, new RegExp(`data-ui="${marker}"`));
    assert.doesNotMatch(html, /Add task/);
    if (state === "error") assert.match(html, /data-tone="danger"/);
    if (state === "loading") { assert.doesNotMatch(html, />[^<\s]+</); assert.match(html, /aria-hidden="true"/); assert.doesNotMatch(html, /aria-label/); }
  }
  assert.match(renderToStaticMarkup(createElement(Surface)), /Add task/);
});
test("the empty composition limits suggestions and retains their action names", () => {
  const html = renderToStaticMarkup(createElement(EmptyState, { glyph: "", text: "No tasks yet.", starters: ["One", "Two", "Three", "Four"].map(text => ({ text, onSelect() {} })) }));
  assert.equal((html.match(/<button/g) ?? []).length, 3);
  assert.doesNotMatch(html, /Four/);
});
