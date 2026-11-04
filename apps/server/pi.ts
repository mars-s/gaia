import {
  Harness,
  createRegistry,
  type ConversationView,
  type Extension,
  type HarnessSettings,
} from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { z } from "zod";
import type { createAuth } from "./auth.ts";
import type { Chat } from "../../packages/protocol/index.ts";
export interface ChatAdapter {
  controls?(): Omit<Chat, "compaction">;
  configure?(modelId: string): Promise<void>;
  compact?(signal: AbortSignal): Promise<"done" | "noop">;
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
  settings: Pick<HarnessSettings, "compaction"> = {},
): Promise<ChatAdapter> {
  const ctx = BACKGROUND_CONTEXT;
  const registry = createRegistry();
  for (const extension of extensions) registry.install(extension);
  const harness = await Harness.open(
    await openNodeSqliteStorage(path),
    {
      models: auth.models,
      registry,
      settings: { ...settings, retry: { maxRetries: 0 } },
    },
    ctx,
  );
  const root = await harness.root(ctx, {
    agent: { model: { provider: "openai-codex", modelId: "gpt-6.1-sol" } },
  });
  // A restarted local slice marks its pending UI run interrupted rather than silently charging another turn.
  await root.abort(ctx);
  let modelId = (await root.agent(ctx)).model?.modelId ?? "gpt-6.1-sol";
  const models = () =>
    auth.models
      .getModels("openai-codex")
      .map(({ id, name, contextWindow }) => ({ id, name, contextWindow }));
  return {
    controls: () => ({ models: models(), modelId }),
    async configure(id) {
      if (!models().some((model) => model.id === id))
        throw new Error("Unknown OpenAI model.");
      await root.configure(
        { model: { provider: "openai-codex", modelId: id } },
        ctx,
      );
      modelId = (await root.agent(ctx)).model?.modelId ?? modelId;
    },
    async compact(signal) {
      signal.throwIfAborted();
      const taskId = await root.compact(undefined, ctx);
      let stopping: Promise<unknown> | undefined;
      const abort = () => {
        stopping = harness.abortTask(taskId, ctx);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      try {
        const task = await harness.waitForTask(taskId, ctx);
        signal.throwIfAborted();
        if (task.state.outcome.status !== "completed")
          throw new Error("Compaction failed.");
        const result = task.state.outcome.result;
        if (result.submissionId !== undefined) {
          const submission = await harness.submission(result.submissionId, ctx);
          if (!submission || (await submission.wait(ctx)).status !== "done")
            throw new Error("Compaction summary could not be placed.");
          signal.throwIfAborted();
          return "done";
        }
        return result.entryId !== undefined ? "done" : "noop";
      } finally {
        signal.removeEventListener("abort", abort);
        await stopping;
      }
    },
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
