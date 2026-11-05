import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyButton, codeText } from "./copy-button";
import { ProgressRow } from "./progress-row";
import { Transcript, MessageMarkdown } from "./transcript";
import type { Thread } from "../../packages/protocol/index.ts";

test("elapsed time appears from three seconds, alongside real activity, and disappears on settlement", (t) => {
  const start = "2026-11-05T00:00:00Z";
  for (const seconds of [0, 2, 3, 12]) {
    t.mock.method(Date, "now", () => Date.parse(start) + seconds * 1000);
    const html = renderToStaticMarkup(
      createElement(ProgressRow, { active: true, startedAt: start }),
    );
    assert.doesNotMatch(html, /Thinking|Running|Working/);
    assert.match(html, /job-avatar-pulse/);
    if (seconds < 3) assert.doesNotMatch(html, /seconds elapsed/);
    else assert.match(html, new RegExp(`${seconds} seconds elapsed`));
  }
  const withActivity = renderToStaticMarkup(
    createElement(ProgressRow, {
      active: true,
      startedAt: start,
      description: "Checking the calendar",
    }),
  );
  assert.match(withActivity, /Checking the calendar/);
  assert.match(withActivity, /12s/);
  const settled = renderToStaticMarkup(
    createElement(ProgressRow, { active: false, startedAt: start }),
  );
  assert.doesNotMatch(settled, /elapsed|job-avatar-pulse/);
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
  assert.match(action, /aria-live="polite">Copy/);
});
