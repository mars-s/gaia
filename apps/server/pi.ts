import {
  Harness,
  createRegistry,
  type ConversationView,
  type Extension,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { z } from "zod";
import type { createAuth } from "./auth.ts";
export interface ChatAdapter {
  run(input: {
    text: string;
    requestId: string;
    onText: (text: string) => void;
    signal: AbortSignal;
  }): Promise<void>;
  close(): Promise<void>;
}
const Content = z.array(
  z.object({ type: z.string(), text: z.string().optional() }).passthrough(),
);
function textContent(value: unknown) {
  const parsed = Content.safeParse(value);
  return parsed.success
    ? parsed.data
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("")
    : "";
}
const Partial = z
  .object({
    generation: z
      .object({
        message: z.object({ content: z.unknown() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export async function createPi(
  path: string,
  auth: ReturnType<typeof createAuth>,
  extensions: Extension[] = [],
): Promise<ChatAdapter> {
  const ctx = BACKGROUND_CONTEXT;
  const registry = createRegistry();
  for (const extension of extensions) registry.install(extension);
  const harness = await Harness.open(
    await openNodeSqliteStorage(path),
    {
      models: auth.models,
      registry,
      settings: { retry: { maxRetries: 0 } },
    },
    ctx,
  );
  const root = await harness.root(ctx, {
    agent: { model: { provider: "openai-codex", modelId: "gpt-6.1-sol" } },
  });
  // A restarted local slice marks its pending UI run interrupted rather than silently charging another turn.
  await root.abort(ctx);
  return {
    async run({ text, requestId, onText, signal }) {
      const submission = await root.submit(
        { type: "input", content: text, requestId },
        ctx,
      );
      const watch = await root.watch(ctx);
      const update = (value: ConversationView) => {
        const live = Partial.safeParse(value.docs["pi.live"]);
        const partial = live.success
          ? textContent(live.data.generation?.message?.content)
          : "";
        if (partial) onText(partial);
      };
      let stopping: Promise<void> | undefined;
      const abort = () => {
        stopping = root.abort(ctx);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      update(watch.value);
      watch.start(async (call) => {
        if (call.kind === "value") update(call.value);
      });
      try {
        const result = await submission.wait(ctx);
        if (result.status === "done" && result.type === "input") {
          const entry = await root.commit((tx) => tx.entry(result.answer), ctx);
          for (const message of entry?.model ?? [])
            if (message.role === "assistant")
              onText(textContent(message.content));
        } else if (!signal.aborted) throw new Error("Model request failed");
      } finally {
        signal.removeEventListener("abort", abort);
        await stopping;
        await watch.stop();
      }
    },
    async close() {
      await harness.close(ctx);
    },
  };
}
