import type { Context } from "@earendil-works/chord";
import type {
  Conversation,
  ConversationView,
  Harness,
} from "@earendil-works/pi-durable";
import type { Models } from "@earendil-works/pi-ai";
import { effortLevels, supportedEffort } from "./model-effort.ts";
import { DEFAULT_IMAGE_LIMITS } from "@earendil-works/pi-durable/tools";
import { z } from "zod";
import type { ConversationAdapter } from "./pi-workspace.ts";

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
export async function conversationAdapter(
  conversation: Conversation,
  harness: Harness,
  models: Models,
  ctx: Context,
): Promise<ConversationAdapter> {
  const agent = await conversation.agent(ctx);
  let modelId = agent.model?.modelId ?? "gpt-6.1-sol";
  let thinkingLevel = agent.thinkingLevel;
  const selected = models.getModel("openai-codex", modelId);
  if (selected) {
    thinkingLevel = supportedEffort(selected, thinkingLevel);
    if (thinkingLevel !== agent.thinkingLevel)
      await conversation.configure({ thinkingLevel }, ctx);
  }
  const catalogue = () =>
    models.getModels("openai-codex").map((model) => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      capabilities: {
        images: model.input.includes("image"),
        thinkingLevels: effortLevels(model),
      },
    }));
  return {
    imageLimits() {
      const limits = models.getModel("openai-codex", modelId)?.inputLimits
        ?.images?.resize;
      return {
        maxWidth: limits?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
        maxHeight: limits?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
        maxBytes: limits?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
      };
    },
    controls: () => ({ models: catalogue(), modelId, thinkingLevel }),
    async configure(id, effort) {
      const model = models.getModel("openai-codex", id);
      if (!model) throw new Error("Unknown OpenAI model.");
      if (effort !== undefined && !effortLevels(model).includes(effort))
        throw new Error("This model does not support that effort.");
      await conversation.configure(
        {
          model: { provider: "openai-codex", modelId: id },
          thinkingLevel: effort ?? supportedEffort(model, thinkingLevel),
        },
        ctx,
      );
      const updated = await conversation.agent(ctx);
      modelId = updated.model?.modelId ?? modelId;
      thinkingLevel = updated.thinkingLevel;
    },
    async compact(signal) {
      signal.throwIfAborted();
      const taskId = await conversation.compact(undefined, ctx);
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
    async run({ text, images = [], requestId, onText, signal }) {
      signal.throwIfAborted();
      if (
        images.length &&
        !models.getModel("openai-codex", modelId)?.input.includes("image")
      )
        throw new Error("This model does not accept images.");
      const submission = await conversation.submit(
        {
          type: "input",
          content: images.length
            ? [...(text ? [{ type: "text" as const, text }] : []), ...images]
            : text,
          requestId,
        },
        ctx,
      );
      const watch = await conversation.watch(ctx);
      const update = (value: ConversationView) => {
        const live = Partial.safeParse(value.docs["pi.live"]);
        const partial = live.success
          ? textContent(live.data.generation?.message?.content)
          : "";
        if (partial) onText(partial);
      };
      let stopping: Promise<void> | undefined;
      const abort = () => {
        stopping = conversation.abort(ctx);
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
          const entry = await conversation.commit(
            (tx) => tx.entry(result.answer),
            ctx,
          );
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
    async close() {},
  };
}
