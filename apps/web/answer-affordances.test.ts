import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyButton, codeText } from "./copy-button";
import { ProgressRow } from "./progress-row";
import { Transcript, MessageMarkdown } from "./transcript";
import type { Thread } from "../../packages/protocol/index.ts";

test("progress never renders a timer, with or without real activity", (t) => {
  for (const seconds of [0, 1, 2, 3, 12, 65, 3600]) {
    for (const description of [undefined, "Checking the calendar"]) {
      let reads = 0;
      t.mock.method(Date, "now", () => Date.parse("2026-11-05T00:00:00Z") + (reads++ === 0 ? 0 : seconds * 1000));
      const html = renderToStaticMarkup(
        createElement(ProgressRow, { active: true, description, children: createElement("button", null, "Stop") }),
      );
      assert.doesNotMatch(html, /elapsed|progress-elapsed|\b\d+(?:m|s)\b|Thinking|Running|Working/);
      assert.match(html, /working-indicator/);
      assert.match(html, />Stop</);
      if (description) assert.match(html, /Checking the calendar/);
      else assert.doesNotMatch(html, /Checking the calendar/);
    }
  }
  const settled = renderToStaticMarkup(createElement(ProgressRow, { active: false }));
  assert.doesNotMatch(settled, /elapsed|working-indicator/);
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

test("copy actions hide at rest for short replies and are absent from setup intros", () => {
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
  assert.equal((html.match(/earlier-answer/g) ?? []).length, 2);
  assert.match(html, />Copy</);
  assert.match(html, /<svg/);
  const card = renderToStaticMarkup(
    createElement(Transcript, { thread, hasSetupCard: (id) => id === "new" }),
  );
  assert.equal((card.match(/aria-label="Copy answer"/g) ?? []).length, 1);
});

test("code copy has a separate 28px header above the bounded scroll area", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    new URL("./transcript.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /element.scrollWidth - element.clientWidth - element.scrollLeft > 1/);
  assert.match(source, /observer.observe\(element\)/);
});

test("code headers label known languages and keep copy outside the pre", () => {
  for (const language of ["ts", ""]) {
    const html = renderToStaticMarkup(createElement(MessageMarkdown, {text: "```" + language + "\nconst long = 'example';\n```"}));
    assert.match(html, /aria-label="Copy code"[\s\S]*<div class="code-scroll-area"><pre>/);
    assert.doesNotMatch(html, /<pre>[\s\S]*<button/);
  }
});

test("reply actions follow the whole turn and sit eight pixels below its content", () => {
 const html = renderToStaticMarkup(createElement(Transcript, { thread: { version: 1, id: "local", run: {kind: "idle"}, messages: [{id: "reply", role: "assistant", text: "Reply text", createdAt: "2026-11-05"}] }, hasSetupCard: () => true, afterMessage: () => createElement("aside", null, "Proposal") }));
 assert.match(html, /Reply text[^]*<\/article>[^]*Proposal/);
 assert.doesNotMatch(html, /Copy answer/);
});

test("code overflow measurement covers narrow screens and the thin scrollbar stays visible", () => {
 const source = readFileSync(new URL("./transcript.tsx", import.meta.url), "utf8");
 assert.doesNotMatch(source, /window.innerWidth >= 640/);
});

test("answer section headings use distinct semibold type scale steps", () => {
 const html = renderToStaticMarkup(createElement(MessageMarkdown, {text: "## Main heading\n\nBody\n\n### Section heading"}));
 assert.match(html, /<h2>Main heading<\/h2>[^]*<h3>Section heading<\/h3>/);
});
import { substantialReply } from "./transcript";
test("Copy stays visible for multiple Markdown blocks and structured content", () => {
 for (const text of ["> # Quoted heading", "> - Quoted list", "First.\n\nSecond.", "# Title", "- Item", "1. Item", "```ts\nlet x=1;\n```", "a | b\n-- | --\n1 | 2"]) assert.equal(substantialReply(text), true, text);
 for (const text of ["One short reply.", "One\nwrapped paragraph.", "> One quote"]) assert.equal(substantialReply(text), false, text);
});
