import { gunzipSync, zstdDecompressSync } from "node:zlib";
import { hasApi } from "@earendil-works/pi-ai";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createModels, fauxProvider } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { searchWeb, createSearchCollector } from "./experience-tools/search.ts";

const completed = {
  type: "web_search_call",
  id: "search-1",
  status: "completed",
  action: {
    type: "search",
    query: "kangaroo",
    sources: [{ type: "url", url: "https://example.org/source" }],
  },
};
const annotation = {
  type: "url_citation",
  url: "https://example.org/source",
  title: "🦘 Source",
};
test("retrieved URLs cannot displace actual provider citations", () => {
  const collector = createSearchCollector();
  collector.collect({
    ...completed,
    action: {
      ...completed.action,
      sources: Array.from({ length: 64 }, (_, i) => ({
        type: "url",
        url: `https://example.org/retrieved-${i}`,
      })),
    },
  });
  collector.collect({
    type: "response.output_text.annotation.added",
    annotation,
  });
  assert.deepEqual(collector.snapshot().citations, [
    { url: annotation.url, title: annotation.title },
  ]);
  assert.equal(collector.snapshot().actions[0].action.sources?.length, 64);
});
function transport(events: unknown[]) {
  const wire = events
    .map((event) => "data: " + JSON.stringify(event) + "\n\n")
    .join("");
  const bytes = new TextEncoder().encode(wire);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i++)
          controller.enqueue(bytes.slice(i, i + 1));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
function fixture(
  events: unknown[],
  onRequest?: (body: Record<string, unknown>) => void,
) {
  const original = openaiCodexProvider();
  const models = createModels();
  const auth = fauxProvider().provider.auth;
  const synthetic =
    "synthetic." +
    Buffer.from(
      JSON.stringify({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "owned-test-account",
        },
      }),
    ).toString("base64url") +
    ".synthetic";
  let requests = 0;
  models.setProvider({
    ...original,
    auth,
    streamSimple(model, context, options) {
      if (!hasApi(model, "openai-codex-responses"))
        throw new Error("Unexpected model API");
      return original.streamSimple(model, context, {
        ...options,
        apiKey: synthetic,
        fetch: async (_url, init) => {
          requests++;
          const bytes = Buffer.from(
            await new Response(init?.body).arrayBuffer(),
          );
          const encoding = new Headers(init?.headers).get("content-encoding");
          const raw =
            encoding === "zstd"
              ? zstdDecompressSync(bytes)
              : encoding === "gzip"
                ? gunzipSync(bytes)
                : bytes;
          onRequest?.(JSON.parse(raw.toString()));
          return transport(events);
        },
      });
    },
  });
  return {
    models,
    requests: () => requests,
    agent: async () => ({
      model: { provider: "openai-codex", modelId: "gpt-6.1-sol" },
      thinkingLevel: "high" as const,
      extensions: [],
      tools: [],
      callable: [],
      deferred: [],
      sections: [],
      settings: {},
    }),
    now: Date.now,
  };
}
const answer = {
  id: "message-1",
  type: "message",
  role: "assistant",
  status: "completed",
  content: [
    {
      type: "output_text",
      text: "Found 🦘 evidence.",
      annotations: [annotation],
    },
  ],
};
const final = (output: unknown[]) => ({
  type: "response.completed",
  response: {
    id: "response-1",
    status: "completed",
    output,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  },
});
test("installed Codex SSE handles split Unicode and final search/citation fallback", async () => {
  const api = fixture([final([completed, answer])], (body) => {
    assert.deepEqual(body.tools, [
      { type: "web_search", external_web_access: true },
    ]);
    assert.equal(body.tool_choice, "required");
    assert(
      Array.isArray(body.include) &&
        body.include.includes("web_search_call.action.sources"),
    );
    assert.deepEqual(body.reasoning, { effort: "high", summary: "auto" });
  });
  const result = await searchWeb(
    "Search kangaroos",
    api,
    ctx,
    new AbortController().signal,
  );
  assert.equal(result.text, "Found 🦘 evidence.");
  assert.equal(result.actions.length, 1);
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0].title, "🦘 Source");
  assert.equal(api.requests(), 1);
});
test("search rejects malformed/no search and an explicit retry has fresh evidence", async () => {
  for (const output of [
    [answer],
    [{ ...completed, action: {} }, answer],
    [{ ...completed, status: "in_progress" }, answer],
  ]) {
    const api = fixture([final(output)]);
    await assert.rejects(
      searchWeb("query", api, ctx, new AbortController().signal),
      /no completed/,
    );
  }
  const api = fixture([
    { type: "response.output_item.done", item: completed },
    final([completed, answer]),
  ]);
  const result = await searchWeb(
    "explicit retry",
    api,
    ctx,
    new AbortController().signal,
  );
  assert.equal(result.actions.length, 1);
});
test("search honours actual context signal and collector bounds", async () => {
  const controller = new AbortController();
  controller.abort();
  const api = fixture([final([completed, answer])]);
  await assert.rejects(searchWeb("query", api, ctx, controller.signal));
  const collector = createSearchCollector();
  for (let i = 0; i < 100; i++)
    collector.collect({
      ...completed,
      id: String(i),
      action: {
        type: "search",
        sources: [{ url: `https://example.org/${i}` }],
      },
    });
  assert.equal(collector.snapshot().actions.length, 32);
  assert.equal(collector.snapshot().citations.length, 0);
  for (let i = 0; i < 100; i++)
    collector.collect({
      type: "url_citation",
      url: `https://example.org/${i}`,
      title: `Source ${i}`,
    });
  assert.equal(collector.snapshot().citations.length, 64);
});
