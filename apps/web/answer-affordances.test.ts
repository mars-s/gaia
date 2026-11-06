import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyButton, codeText } from "./copy-button";
import { ProgressRow } from "./progress-row";
import { Transcript, MessageMarkdown } from "./transcript";
import type { Thread } from "../../packages/protocol/index.ts";

test("elapsed time appears from one second, alongside real activity, and disappears on settlement", (t) => {
  const start = "2026-11-05T00:00:00Z";
  for (const seconds of [0, 1, 2, 3, 12, 65]) {
    t.mock.method(Date, "now", () => Date.parse(start) + seconds * 1000);
    const html = renderToStaticMarkup(
      createElement(ProgressRow, { active: true, startedAt: start }),
    );
    assert.doesNotMatch(html, /Thinking|Running|Working/);
    assert.match(html, /working-indicator/);
    if (seconds < 1) assert.doesNotMatch(html, /seconds elapsed/);
    else { assert.match(html, new RegExp(`${seconds} seconds elapsed`)); if (seconds === 1) assert.match(html, />1s</); }
  }
  const withActivity = renderToStaticMarkup(
    createElement(ProgressRow, {
      active: true,
      startedAt: start,
      description: "Checking the calendar",
    }),
  );
  assert.match(withActivity, /Checking the calendar/);
  assert.match(withActivity, /1m 5s/);
  const settled = renderToStaticMarkup(
    createElement(ProgressRow, { active: false, startedAt: start }),
  );
  assert.doesNotMatch(settled, /elapsed|working-indicator/);
});

test("Original chat starts its elapsed clock at observation rather than inventing a server start time", () => {
  const html = renderToStaticMarkup(
    createElement(ProgressRow, { active: true }),
  );
  assert.doesNotMatch(html, /seconds elapsed/);
});

test("settled assistant answers have one accessible copy action, pending and failed answers have none", () => {
  const base: Thread = {
    version: 1,
    id: "local",
    run: { kind: "idle" },
    messages: [
      {
        id: "user",
        role: "user",
        text: "My input",
        createdAt: "2026-11-05T00:00:00Z",
      },
      {
        id: "answer",
        role: "assistant",
        text: "**Keep** this answer",
        createdAt: "2026-11-05T00:00:01Z",
      },
    ],
  };
  const render = (thread: Thread) =>
    renderToStaticMarkup(createElement(Transcript, { thread }));
  assert.equal(
    (render(base).match(/aria-label="Copy answer"/g) ?? []).length,
    1,
  );
  for (const run of [
    { kind: "running", id: "job", operation: "reply" },
    { kind: "error", message: "Connection lost" },
    { kind: "stopped" },
  ] satisfies Thread["run"][]) {
    assert.doesNotMatch(render({ ...base, run }), /aria-label="Copy answer"/);
  }
});

test("code blocks have their own copy action and preserve the exact plain code", () => {
  const code = 'const x = "<&>";\nconsole.log(x);\n';
  const html = renderToStaticMarkup(
    createElement(MessageMarkdown, {
      text: `Before\n\n\`\`\`typescript\n${code}\`\`\`\n\nInline \`x\``,
    }),
  );
  assert.equal((html.match(/aria-label="Copy code"/g) ?? []).length, 1);
  assert.match(html, /<pre><code class="language-typescript">/);
  assert.equal(codeText(createElement("code", null, code)), code);
  const action = renderToStaticMarkup(
    createElement(CopyButton, { label: "Copy code", text: code }),
  );
  assert.match(action, /type="button"/);
  assert.match(action, /class="sr-only" aria-live="polite"><\/span>/);
});

test("working motion is separate from Gaia identity, including with real activity", () => {
  for (const description of [undefined, "Checking the calendar"]) {
    const html = renderToStaticMarkup(
      createElement(ProgressRow, { active: true, description }),
    );
    assert.match(html, /class="progress-avatar"[^>]*><span class="gaia-mark"/);
    assert.match(
      html,
      /class="working-indicator"[^>]*><i><\/i><i><\/i><i><\/i>/,
    );
    assert.doesNotMatch(html, /job-avatar-pulse/);
  }
});

test("copy actions have icons without Copy text and setup answers keep their action", () => {
  const thread: Thread = {
    version: 1,
    id: "local",
    run: { kind: "idle" },
    messages: [
      {
        id: "old",
        role: "assistant",
        text: "Earlier answer",
        createdAt: "2026-11-05T00:00:00Z",
      },
      {
        id: "new",
        role: "assistant",
        text: "Review below",
        createdAt: "2026-11-05T00:00:01Z",
      },
    ],
  };
  const html = renderToStaticMarkup(createElement(Transcript, { thread }));
  assert.equal((html.match(/aria-label="Copy answer"/g) ?? []).length, 2);
  assert.equal((html.match(/earlier-answer/g) ?? []).length, 1);
  assert.doesNotMatch(html, />Copy</);
  assert.match(html, /<svg/);
  const card = renderToStaticMarkup(
    createElement(Transcript, { thread, hasSetupCard: (id) => id === "new" }),
  );
  assert.equal((card.match(/aria-label="Copy answer"/g) ?? []).length, 2);
});

test("code copy has a separate 28px header above the bounded scroll area", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
  const source = readFileSync(
    new URL("./transcript.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /element.scrollWidth - element.clientWidth - element.scrollLeft > 1/);
  assert.match(source, /observer.observe\(element\)/);
  assert.match(css, /code-header \{ height: 28px/);
  assert.match(css, /code-block \{[^}]*max-width: 100%; overflow: hidden/);
  assert.match(css, /padding: 16px; border-radius: 0; overflow-x: auto/);
  assert.match(css, /code-block\[data-overflow="true"\] .code-scroll-area::after/);
  assert.match(css, /earlier-answer:focus-within > .reply-actions/);
  assert.match(css, /@media \(pointer: coarse\)/);
});

test("code headers label known languages and keep copy outside the pre", () => {
  for (const language of ["ts", ""]) {
    const html = renderToStaticMarkup(createElement(MessageMarkdown, {text: "```" + language + "\nconst long = 'example';\n```"}));
    assert.match(html, new RegExp('class="code-header"><span>' + (language === 'ts' ? 'TypeScript' : 'Code') + '</span>'));
    assert.match(html, /aria-label="Copy code"[\s\S]*<div class="code-scroll-area"><pre>/);
    assert.doesNotMatch(html, /<pre>[\s\S]*<button/);
  }
});

test("code scrolls below 640 with a fade and the transcript has a clean top edge", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.doesNotMatch(css, /mask-image/);
 assert.match(css, /code-block pre \{ white-space: pre; overflow-wrap: normal/);
 assert.match(css, /owner-bubble \{ background: var\(--color-surface-selected\)/);
});

test("reply actions precede proposal content and sit eight pixels below the text", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /reply-actions \{ margin-top: 8px; display: flex/);
 assert.match(css, /reply-actions .copy-action \{ margin-top: 0/);
 const html = renderToStaticMarkup(createElement(Transcript, { thread: { version: 1, id: "local", run: {kind: "idle"}, messages: [{id: "reply", role: "assistant", text: "Reply text", createdAt: "2026-11-05"}] }, afterMessage: () => createElement("aside", null, "Proposal") }));
 assert.match(html, /Reply text[^]*reply-actions[^]*Copy answer[^]*Proposal/);
});

test("code overflow measurement covers narrow screens and the thin scrollbar stays visible", () => {
 const source = readFileSync(new URL("./transcript.tsx", import.meta.url), "utf8");
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.doesNotMatch(source, /window.innerWidth >= 640/);
 assert.doesNotMatch(css, /pre-wrap; overflow-wrap: anywhere; overflow-x: visible/);
 assert.match(css, /pre::-webkit-scrollbar \{ height: 4px/);
 assert.match(css, /pre::-webkit-scrollbar-thumb \{ background: var\(--color-line-strong\)/);
});

test("answer section headings use distinct semibold type scale steps", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 for (const [heading, token] of [["h2", "title-2"], ["h3", "title-3"]]) {
   assert.match(css, new RegExp(`message-markdown ${heading} \\{[^}]*font-size: var\\(--text-${token}-semibold\\);[^}]*line-height: var\\(--text-${token}-semibold--line-height\\);[^}]*font-weight: var\\(--text-${token}-semibold--font-weight\\)`));
 }
 const html = renderToStaticMarkup(createElement(MessageMarkdown, {text: "## Main heading\n\nBody\n\n### Section heading"}));
 assert.match(html, /<h2>Main heading<\/h2>[^]*<h3>Section heading<\/h3>/);
});
