import { randomUUID } from "node:crypto";
import type { Context } from "@earendil-works/chord";
import {
  defineDoc,
  type Conversation,
  type Harness,
} from "@earendil-works/pi-durable";
import type { Chat, Message } from "../../packages/protocol/index.ts";
import { AreaSnapshot } from "../../packages/sdk/areas.ts";
import {
  AreaId,
  type WorkspaceRequest,
  type WorkspaceConfirmation,
} from "../../packages/sdk/workspace.ts";
import type { ChatAdapter } from "./pi.ts";
import { openWorkspace } from "./workspace.ts";

export type ConversationAdapter = Required<Omit<ChatAdapter, "workspace">>;
type AreaInput = Omit<Parameters<ChatAdapter["run"]>[0], "owner" | "onText"> & {
  areaId: AreaId;
  addUser: boolean;
  selection?: Message["selection"];
  onAdmitted?: () => void;
};

const AreaProjection = defineDoc<{ value: AreaSnapshot | null }>({
  kind: "gaia.area-chat",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ value: null }),
  checkpointWhen: () => true,
});

export class WorkspaceError extends Error {}

export async function createWorkspaceChat(
  {
    harness,
    home,
    adapter,
    createAdapter,
    areasEnabled,
  }: {
    harness: Harness;
    home: Conversation;
    adapter: ConversationAdapter;
    createAdapter: (conversation: Conversation) => Promise<ConversationAdapter>;
    areasEnabled: boolean;
  },
  ctx: Context,
) {
  const workspace = await openWorkspace({ harness, home }, ctx);
  let state = await workspace.read(ctx);
  const requestIds = new Set<string>();
  const areas = new Map<
    AreaId,
    {
      conversation: Conversation;
      adapter: ConversationAdapter;
      snapshot: AreaSnapshot;
    }
  >();

  async function loadAreas() {
    if (state.kind !== "confirmed" || state.proposal.workspace.kind !== "multi")
      return;
    for (const area of state.proposal.workspace.areas) {
      if (areas.has(area.areaId)) continue;
      const conversation = await workspace.resolveArea(area.areaId, ctx);
      const adapter = await createAdapter(conversation);
      const saved = await harness.snapshot(
        AreaProjection,
        conversation.id,
        ctx,
      );
      const snapshot: AreaSnapshot = saved?.value
        ? AreaSnapshot.parse(saved.value)
        : {
            areaId: area.areaId,
            thread: {
              version: 1,
              id: "local",
              messages: [],
              run: { kind: "idle" },
            },
            chat: { ...adapter.controls(), compaction: { kind: "idle" } },
          };
      if (snapshot.areaId !== area.areaId)
        throw new Error("Area projection belongs to another area.");
      if (snapshot.thread.run.kind === "running")
        snapshot.thread.run =
          snapshot.thread.run.operation &&
          snapshot.thread.run.operation !== "reply"
            ? { kind: "idle" }
            : {
                kind: "error",
                message:
                  "The server restarted during this work. Try again when ready.",
              };
      if (snapshot.chat.compaction.kind === "running")
        snapshot.chat.compaction = {
          kind: "error",
          message: "Compaction interrupted by restart.",
        };
      areas.set(area.areaId, { conversation, adapter, snapshot });
      await save(area.areaId);
    }
  }
  function resolve(areaId: AreaId) {
    if (!areasEnabled)
      throw new WorkspaceError(
        "Areas require the verified recovery baseline upgrade.",
      );
    const area = areas.get(areaId);
    if (!area) throw new WorkspaceError("Unknown confirmed workspace area.");
    return area;
  }
  async function save(areaId: AreaId) {
    const area = areas.get(areaId);
    if (!area) throw new Error("Area projection is missing.");
    const value = AreaSnapshot.parse(area.snapshot);
    await harness.commit(async (tx) => {
      const doc = await tx.doc(AreaProjection, area.conversation.id);
      doc.value = value;
    }, ctx);
    for (const message of value.thread.messages)
      if (message.role === "user") requestIds.add(message.id);
  }
  await loadAreas();

  return {
    read: () => state,
    requestIds: () => [...requestIds],
    async propose(input: WorkspaceRequest, signal: AbortSignal) {
      signal.throwIfAborted();
      if (state.kind === "confirmed")
        throw new WorkspaceError("Workspace is already confirmed.");
      const proposal = await workspace.propose(input, ctx);
      state = await workspace.read(ctx);
      return proposal;
    },
    async confirm(input: WorkspaceConfirmation, signal: AbortSignal) {
      signal.throwIfAborted();
      if (
        !areasEnabled &&
        state.kind !== "empty" &&
        state.proposal.workspace.kind === "multi"
      )
        throw new WorkspaceError(
          "Areas require the verified recovery baseline upgrade.",
        );
      const controls = adapter.controls();
      const result = await workspace.confirm(
        input,
        {
          model: { provider: "openai-codex", modelId: controls.modelId },
          thinkingLevel: controls.thinkingLevel ?? "off",
        },
        ctx,
      );
      state = await workspace.read(ctx);
      await loadAreas();
      return result;
    },
    snapshot(areaId: AreaId): AreaSnapshot {
      const area = resolve(areaId);
      return {
        ...area.snapshot,
        chat: {
          ...area.adapter.controls(),
          compaction: area.snapshot.chat.compaction,
        },
      };
    },
    imageLimits(areaId: AreaId) {
      return resolve(areaId).adapter.imageLimits();
    },
    async configure(
      areaId: AreaId,
      modelId: string,
      thinkingLevel: Chat["thinkingLevel"],
      signal: AbortSignal,
    ) {
      signal.throwIfAborted();
      const area = resolve(areaId);
      await area.adapter.configure(modelId, thinkingLevel);
      area.snapshot.chat = {
        ...area.adapter.controls(),
        compaction: area.snapshot.chat.compaction,
      };
      await save(areaId);
    },
    async compact(areaId: AreaId, signal: AbortSignal) {
      const area = resolve(areaId);
      const previous = area.snapshot.thread.run;
      area.snapshot.thread.run = {
        kind: "running",
        id: randomUUID(),
        operation: "compact",
      };
      area.snapshot.chat.compaction = {
        kind: "running",
        message: "Compacting conversation context.",
      };
      try {
        await save(areaId);
        const kind = await area.adapter.compact(signal);
        signal.throwIfAborted();
        area.snapshot.chat.compaction = { kind };
      } catch {
        area.snapshot.chat.compaction = {
          kind: "error",
          message: signal.aborted
            ? "Compaction stopped."
            : "Compaction failed. Try again when ready.",
        };
      } finally {
        area.snapshot.thread.run = previous;
        await save(areaId);
      }
    },
    async run(input: AreaInput): Promise<string> {
      const area = resolve(input.areaId);
      input.signal.throwIfAborted();
      const { thread } = area.snapshot;
      if (thread.run.kind === "running")
        throw new WorkspaceError("Work is already running.");
      const selection = input.selection ?? area.adapter.controls();
      const createdAt = new Date().toISOString();
      if (input.addUser)
        thread.messages.push({
          id: input.requestId,
          role: "user",
          text: input.text,
          createdAt,
          selection: {
            modelId: selection.modelId,
            thinkingLevel: selection.thinkingLevel,
          },
          ...(input.attachments?.length
            ? { attachments: input.attachments }
            : {}),
        });
      const answer = {
        id: randomUUID(),
        role: "assistant" as const,
        text: "",
        createdAt,
      };
      thread.messages.push(answer);
      thread.run = { kind: "running", id: answer.id };
      try {
        await save(input.areaId);
        input.onAdmitted?.();
        if (input.selection)
          await area.adapter.configure(
            input.selection.modelId,
            input.selection.thinkingLevel,
          );
        await area.adapter.run({
          ...input,
          onText: (text) => {
            answer.text = text;
            void save(input.areaId).catch(() => {});
          },
        });
        input.signal.throwIfAborted();
        thread.run = { kind: "idle" };
        return answer.text;
      } catch (error) {
        thread.run = input.signal.aborted
          ? { kind: "stopped" }
          : {
              kind: "error",
              message:
                "The area could not finish this reply. Check your connection, then retry.",
            };
        throw error;
      } finally {
        area.snapshot.chat = {
          ...area.adapter.controls(),
          compaction: area.snapshot.chat.compaction,
        };
        await save(input.areaId);
      }
    },
  };
}
export type WorkspaceChat = Awaited<ReturnType<typeof createWorkspaceChat>>;
