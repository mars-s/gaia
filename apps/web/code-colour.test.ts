import { readFileSync } from "node:fs";
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

 test("strings use primary ink while comments use secondary ink in both themes", () => {
 const theme = readFileSync(new URL("./styles/theme.css", import.meta.url), "utf8");
 assert.match(theme, /--color-code-string: var\(--color-ink\)/);
 assert.match(theme, /--color-code-comment: var\(--color-ink-2\)/);
 assert.doesNotMatch(theme, /--color-code-string: var\(--color-ink-[23]\)/);
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /code-string \{ color: var\(--color-code-string\)/);
 });
