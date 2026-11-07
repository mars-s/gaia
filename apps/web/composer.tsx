import { Action } from "./ui";
import { useEffect } from "react";
import { SharedComposer } from "./shared-composer";
import {
  stopScope,
  type ConversationController,
} from "./conversation-controller";
import { scopeKey, type ConversationScope } from "./workspace-controller";

export function Composer({
  controller,
  scope,
  onHistory,
  onSend,
}: {
  controller: ConversationController;
  scope: ConversationScope;
  onHistory?: () => void;
  onSend: () => void;
}) {
  const entry = controller.session(scope);
  const state = entry.draftState;
  const draft = state.kind === "ready" ? state.draft.text : "";
  const images = state.kind === "ready" ? state.draft.images : [];
  const current = controller.view(scope);
  const running = current?.thread.run.kind === "running";
  const pending = Boolean(controller.pending || controller.selectionPending);
  const offline = controller.offline;
  const supportsImages = controller.supportsImages(scope);
  const stop = stopScope(controller.home, scope, current?.thread);
  const error = entry.error;
  const busy = controller.busyScope();
  const busyElsewhere = busy && scopeKey(busy) !== scopeKey(scope) && !stop;
  const busyName =
    busy?.kind === "home"
      ? "Home"
      : controller.workspace
          .areaList()
          .find(
            (area) =>
              area.areaId === (busy?.kind === "area" ? busy.areaId : undefined),
          )?.label;
  useEffect(() => () => controller.compose(scope, false), [controller, scope]);
  function send() {
    if (controller.canSend(scope)) {
      onSend();
      void controller.send(scope);
    }
  }
  const progress = entry.reads
    ? "Reading images…"
    : entry.progress.kind === "uploading"
      ? `Uploading image ${entry.progress.completed + 1} of ${entry.progress.total}…`
      : entry.progress.kind === "sending"
        ? "Sending…"
        : "";
  return (
    <>
      {busyElsewhere && (
        <p role="status" className="text-caption-1-regular text-text-secondary">
          {busyName ?? "Another conversation"} is working.{" "}
          <Action
            type="button"
            className="quiet-action quiet-link"
            onClick={() => controller.select(busy)}
          >
            Open conversation
          </Action>
        </p>
      )}
      {!controller.safeMode && !controller.workspace.ready() && !offline && (
        <p role="status" className="text-caption-1-regular text-text-secondary">
          {controller.workspace.error
            ? "Workspace unavailable."
            : "Checking conversation status…"}{" "}
          <Action
            className="quiet-action quiet-link"
            type="button"
            onClick={() => void controller.workspace.refresh()}
          >
            Retry
          </Action>
        </p>
      )}
      {scope.kind === "area" &&
        controller.workspace.areas.get(scope.areaId)?.status ===
          "reconnecting" && (
          <p
            role="status"
            className="text-caption-1-regular text-text-secondary"
          >
            Area connection lost. Retrying… Your draft is here.
          </p>
        )}
      {error && (
        <p role="alert" className="chat-notice">
          {error}
        </p>
      )}
      {state.kind === "error" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-text-secondary"
        >
          <p>{state.message}</p>
          <Action
            className="quiet-action"
            onClick={() => void entry.draft.load()}
          >
            Retry draft
          </Action>
        </div>
      ) : state.kind === "ready" && state.durability === "memory" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-text-secondary"
        >
          <p>Your draft is kept in this window. Storage is unavailable.</p>
          <Action
            className="quiet-action"
            onClick={() => entry.draft.retrySave()}
          >
            Retry saving
          </Action>
        </div>
      ) : null}
      {images.length > 0 && !supportsImages && (
        <p role="alert" className="text-caption-1-regular text-text-secondary">
          This model cannot use images. Choose another model or remove the
          images to send.
        </p>
      )}
      <span className="sr-only" role="status">
        {state.kind === "loading"
          ? "Loading saved draft"
          : running
            ? current?.thread.run.kind === "running" &&
              current.thread.run.operation === "compact"
              ? "Compacting context"
              : "Gaia is working"
            : ""}
      </span>
      {progress && (
        <p
          role="status"
          className="px-2 text-caption-1-regular text-text-secondary"
        >
          {progress}
        </p>
      )}
      <SharedComposer
        label="Message Gaia"
        placeholder="Message Gaia…"
        draft={draft}
        images={images}
        ready={state.kind === "ready"}
        supportsImages={supportsImages}
        actionsDisabled={
          pending || offline || Boolean(busy) || !controller.available(scope)
        }
        modelDisabled={controller.modelDisabled(scope)}
        canSend={controller.canSend(scope)}
        chat={current?.chat}
        selection={entry.selection}
        onSelect={(value) => entry.queue.select(value)}
        onChange={(text) => {
          entry.error = "";
          entry.draft.update((value) => ({ ...value, text }));
        }}
        onRemove={(id) =>
          entry.draft.update((value) => ({
            ...value,
            images: value.images.filter((image) => image.id !== id),
          }))
        }
        onImages={(files) => void controller.addImages(scope, files)}
        onCompose={(value) => controller.compose(scope, value)}
        onCompact={() => void controller.act(scope, "compact")}
        onHistory={onHistory}
        onSend={send}
        onStop={
          entry.progress.kind === "uploading"
            ? () => entry.upload?.abort()
            : stop
              ? () => void controller.stop(scope)
              : undefined
        }
        stopLabel={
          entry.progress.kind === "uploading"
            ? "Cancel image upload"
            : current?.thread.run.kind === "running" &&
                current.thread.run.operation === "compact"
              ? "Stop compaction"
              : stop?.kind === "home" && scope.kind === "area"
                ? "Stop Home and routed reply"
                : "Stop reply"
        }
        stopDisabled={
          entry.progress.kind !== "uploading" && (pending || offline)
        }
      />
      {current?.chat && current.chat.compaction.kind !== "idle" && (
        <p
          role={current.chat.compaction.kind === "error" ? "alert" : "status"}
          className="px-2 text-caption-1-regular text-text-secondary"
        >
          {current.chat.compaction.message}
        </p>
      )}
    </>
  );
}
