import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColourCode, languageLabel } from "./code-colour";
import { codeText } from "./copy-button";

test("code colouring preserves exact copy text and safely renders strings and comments", () => {
  const text = 'const x = "<script>"; // let untouched\nreturn 42;\n';
  const node = ColourCode({ text, language: "typescript" });
  assert.equal(codeText(node), text);
  const html = renderToStaticMarkup(node);
  assert.match(html, /code-keyword">const/);
  assert.match(html, /code-string/);
  assert.match(html, /code-comment">\/\/ let untouched/);
  assert.match(html, /code-number">42/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(languageLabel("typescript"), "TypeScript");
  assert.equal(languageLabel("json"), "JSON");
  assert.equal(languageLabel("rust"), "Rust");
  assert.equal(renderToStaticMarkup(createElement(ColourCode, { text: "const plain", language: "unknown" })), "const plain");
});
