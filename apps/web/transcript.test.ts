import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Transcript,
  MessageMarkdown,
  markdownUrl,
  transcriptMessages,
} from "./transcript.tsx";
import type { Thread } from "../../packages/protocol/index.ts";

test("real Markdown renders emphasis, code, lists and tables without HTML, unsafe links or tracking images", () => {
  const html = renderToStaticMarkup(
    createElement(MessageMarkdown, {
      text: [
        "**Save** and `code`",
        "- First\n- Second",
        "| One | Two |\n| --- | --- |\n| A | B |",
        '<script>alert("bad")</script>',
        "[Unsafe](javascript:alert%281%29)",
        "[Docs](https://example.org/docs)",
        "![Tracking](https://example.org/track.png)",
      ].join("\n\n"),
    }),
  );
  assert(html.includes("<strong>Save</strong>"));
  assert(html.includes("<code>code</code>"));
  assert(html.includes("<li>First</li>"));
  assert(html.includes("<table>"));
  assert(!html.includes("<script"));
  assert(!html.includes("javascript:"));
  assert(!html.includes("<img"));
  assert(!html.includes("track.png"));
  assert(html.includes('rel="noopener noreferrer"'));
  assert(html.includes('referrerPolicy="no-referrer"'));
  for (const url of [
    "data:text/html,bad",
    "//example.org/track",
    "\\\\example.org",
    "javascript:alert(1)",
    " java\nscript:bad",
  ])
    assert.equal(markdownUrl(url), "");
  assert.equal(markdownUrl("/api/v1/attachments/id"), "/api/v1/attachments/id");
});

test("assistant-ui renders retained messages from the server with separate attempts and owned images", () => {
  const thread: Thread = {
    version: 1,
    id: "local",
    run: { kind: "stopped" },
    messages: [
      {
        id: "u",
        role: "user",
        text: "**Literal user text**",
        createdAt: "2026-11-05T00:00:00Z",
      },
      {
        id: "a1",
        role: "assistant",
        text: "**Save**",
        createdAt: "2026-11-05T00:00:01Z",
      },
      {
        id: "a2",
        role: "assistant",
        text: "",
        createdAt: "2026-11-05T00:00:02Z",
      },
    ],
  };
  const messages = transcriptMessages(thread);
  assert.deepEqual(
    messages.map((m) => m.id),
    ["u", "a1", "a2"],
  );
  assert.deepEqual(messages[1]?.status, { type: "complete", reason: "stop" });
  assert.deepEqual(messages[2]?.status, {
    type: "incomplete",
    reason: "cancelled",
  });
  const html = renderToStaticMarkup(createElement(Transcript, { thread }));
  assert(html.includes("**Literal user text**"));
  assert(html.includes("<strong>Save</strong>"));
  assert(html.includes("Reply stopped."));
  assert.equal((html.match(/<article/g) ?? []).length, 3);
});
