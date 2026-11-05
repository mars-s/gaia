import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { z } from "zod";
const RecordValue = z.record(z.string(), z.unknown());
const Action = z.object({
  type: z.literal("search"),
  query: z.string().max(16000).optional(),
  queries: z.array(z.string().max(16000)).max(32).optional(),
  sources: z
    .array(
      z.object({
        type: z.string().max(100).optional(),
        url: z.string().max(4000),
        title: z.string().max(1000).optional(),
      }),
    )
    .max(64)
    .optional(),
});
const Citation = z.object({
  url: z
    .url()
    .max(4000)
    .refine((url) => /^https?:\/\//.test(url)),
  title: z.string().max(1000).catch(""),
});
export function createSearchCollector() {
  const actions = new Map<string, z.infer<typeof Action>>();
  let finalText = "";
  const citations = new Map<string, z.infer<typeof Citation>>();
  function collect(value: unknown, depth = 0) {
    if (depth > 12) return;
    if (Array.isArray(value)) {
      for (const part of value.slice(0, 200)) collect(part, depth + 1);
      return;
    }
    const parsed = RecordValue.safeParse(value);
    if (!parsed.success) return;
    const item = parsed.data;
    if (
      (item.type === "response.completed" || item.type === "response.done") &&
      typeof item.response === "object"
    ) {
      const response = z
        .object({
          output: z
            .array(
              z
                .object({
                  type: z.string(),
                  content: z
                    .array(
                      z
                        .object({
                          type: z.string(),
                          text: z.string().optional(),
                        })
                        .passthrough(),
                    )
                    .optional(),
                })
                .passthrough(),
            )
            .max(200),
        })
        .safeParse(item.response);
      if (response.success)
        finalText = response.data.output
          .flatMap((part) => part.content ?? [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text ?? "")
          .join("\n")
          .slice(0, 24000);
    }
    if (
      item.type === "web_search_call" &&
      item.status === "completed" &&
      typeof item.id === "string" &&
      Action.safeParse(item.action).success &&
      actions.size < 32
    )
      actions.set(item.id, Action.parse(item.action));
    if (item.type === "url_citation") {
      const citation = Citation.safeParse(item);
      if (citation.success && citations.size < 64)
        citations.set(citation.data.url, citation.data);
    }
    for (const child of Object.values(item))
      if (typeof child === "object" && child !== null)
        collect(child, depth + 1);
  }
  return {
    collect,
    snapshot: () => ({
      finalText,
      actions: [...actions].map(([id, action]) => ({ id, action })),
      citations: [...citations.values()],
    }),
  };
}
export async function searchWeb(
  query: string,
  api: Pick<ToolExecutionApi, "agent" | "models" | "now">,
  context: Context,
  signal: AbortSignal,
) {
  const agent = await api.agent(context);
  if (agent.model?.provider !== "openai-codex")
    throw new Error(
      "Hosted search requires the calling agent’s openai-codex model.",
    );
  const model = api.models.getModel(agent.model.provider, agent.model.modelId);
  if (!model) throw new Error("Calling model is unavailable.");
  const collector = createSearchCollector();
  const result = await api.models.completeSimple(
    model,
    { messages: [{ role: "user", content: query, timestamp: api.now() }] },
    {
      reasoning:
        agent.thinkingLevel === "off" ? undefined : agent.thinkingLevel,
      transport: "sse",
      signal,
      maxRetries: 0,
      onPayload(payload) {
        const body = RecordValue.parse(payload);
        return {
          ...body,
          tools: [{ type: "web_search", external_web_access: true }],
          tool_choice: "required",
          include: [
            ...new Set([
              ...z.array(z.string()).catch([]).parse(body.include),
              "web_search_call.action.sources",
            ]),
          ],
        };
      },
      onProviderStreamEvent: (event) => collector.collect(event),
    },
  );
  signal.throwIfAborted();
  collector.collect(result);
  const evidence = collector.snapshot();
  if (result.stopReason === "error" || result.stopReason === "aborted")
    throw new Error(result.errorMessage || "Search request failed.");
  if (!evidence.actions.length)
    throw new Error("Provider returned no completed hosted search action.");
  const text =
    result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .slice(0, 24000) || evidence.finalText;
  return { text, actions: evidence.actions, citations: evidence.citations };
}
