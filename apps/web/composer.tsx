import { useEffect, useRef, useState } from "react";
import { RiArrowUpLine, RiStopFill } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import { Textarea } from "@/components/base/textarea/textarea";
import { DraftImages } from "./image-previews";
import { ComposerActions, ComposerControls } from "./composer-controls";
import {
  stopScope,
  type ConversationController,
} from "./conversation-controller";
import { scopeKey, type ConversationScope } from "./workspace-controller";
import { cx } from "@/utils/cx";

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
  const canRetry =
    current?.thread.run.kind === "error" ||
    current?.thread.run.kind === "stopped";
  const error =
    entry.error ||
    (current?.thread.run.kind === "error" ? current.thread.run.message : "");
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
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state.kind === "ready") input.current?.focus();
  }, [state.kind]);
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
          <button
            type="button"
            className="quiet-link"
            onClick={() => controller.select(busy)}
          >
            Open conversation
          </button>
        </p>
      )}
      {!controller.safeMode && !controller.workspace.ready() && !offline && (
        <p role="status" className="text-caption-1-regular text-text-secondary">
          {controller.workspace.error
            ? "Workspace unavailable."
            : "Checking conversation status…"}{" "}
          <button
            className="quiet-link"
            type="button"
            onClick={() => void controller.workspace.refresh()}
          >
            Retry
          </button>
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
      {(error || canRetry) && (
        <div
          className="flex flex-wrap items-center gap-2"
          role={error ? "alert" : undefined}
        >
          {error && (
            <p className="min-w-0 flex-1 wrap-anywhere text-text-error-primary">
              {error}
            </p>
          )}
          {canRetry && (
            <Button
              className="quiet-action"
              variant="ghost"
              size="small"
              disabled={
                pending ||
                offline ||
                running ||
                Boolean(busy) ||
                !controller.available(scope)
              }
              onClick={() => void controller.act(scope, "retry")}
            >
              Try again
            </Button>
          )}
        </div>
      )}
      {state.kind === "error" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-text-secondary"
        >
          <p>{state.message}</p>
          <Button
            className="quiet-action"
            variant="ghost"
            size="small"
            onClick={() => void entry.draft.load()}
          >
            Retry draft
          </Button>
        </div>
      ) : state.kind === "ready" && state.durability === "memory" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 text-text-secondary"
        >
          <p>Your draft is kept in this window. Storage is unavailable.</p>
          <Button
            className="quiet-action"
            variant="ghost"
            size="small"
            onClick={() => entry.draft.retrySave()}
          >
            Retry saving
          </Button>
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
      <form
        className={cx(
          "composer flex flex-col gap-2 rounded-[28px] border border-transparent bg-background-tertiary-default p-2",
          dragging && "composer-dragging",
        )}
        aria-label="Message Gaia"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(
              event.relatedTarget instanceof Node ? event.relatedTarget : null,
            )
          )
            setDragging(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          setDragging(false);
          void controller.addImages(
            scope,
            Array.from(event.dataTransfer.files),
          );
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (!files.length) return;
          event.preventDefault();
          void controller.addImages(scope, files);
          const text = event.clipboardData.getData("text/plain");
          const start = input.current?.selectionStart ?? draft.length;
          const end = input.current?.selectionEnd ?? start;
          if (text)
            entry.draft.update((value) => ({
              ...value,
              text: (
                value.text.slice(0, start) +
                text +
                value.text.slice(end)
              ).slice(0, 32000),
            }));
        }}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {images.length > 0 && (
          <DraftImages
            images={images}
            onRemove={(id) =>
              entry.draft.update((value) => ({
                ...value,
                images: value.images.filter((image) => image.id !== id),
              }))
            }
          />
        )}
        {dragging && (
          <span className="px-3 pt-1 text-caption-1-medium text-text-secondary">
            Drop images to attach
          </span>
        )}
        <input
          ref={file}
          className="hidden"
          type="file"
          tabIndex={-1}
          accept="image/png,image/jpeg,image/webp"
          multiple
          aria-label="Choose images"
          disabled={!supportsImages || state.kind !== "ready"}
          onChange={(event) => {
            void controller.addImages(
              scope,
              Array.from(event.target.files ?? []),
            );
            event.target.value = "";
          }}
        />
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
          <ComposerActions
            disabled={
              pending ||
              offline ||
              Boolean(busy) ||
              !controller.available(scope)
            }
            onAttach={
              supportsImages && state.kind === "ready"
                ? () => file.current?.click()
                : undefined
            }
            onCompact={() => void controller.act(scope, "compact")}
            onHistory={onHistory}
          />
          <Textarea
            ref={input}
            className="col-start-2 row-start-1 w-full min-w-0"
            fieldClassName="rounded-2xl bg-transparent ring-0 hover:ring-0 focus-within:ring-0"
            inputClassName="placeholder:text-text-secondary focus:placeholder:text-text-secondary"
            aria-label="Message Gaia"
            rows={1}
            autoResize
            maxRows={8}
            maxLength={32000}
            value={draft}
            isDisabled={state.kind !== "ready"}
            onChange={(text) => {
              entry.error = "";
              entry.draft.update((value) => ({ ...value, text }));
            }}
            onCompositionStart={() => controller.compose(scope, true)}
            onCompositionEnd={() => controller.compose(scope, false)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.keyCode !== 229
              ) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Ask me anything…"
          />
          {current?.chat && (
            <ComposerControls
              chat={current.chat}
              disabled={controller.modelDisabled(scope)}
              selection={entry.selection}
              onSelect={(value) => entry.queue.select(value)}
            />
          )}
          <IconButton
            className="col-start-3 row-start-1 shrink-0 self-end rounded-full border-transparent bg-accent-500 text-text-white shadow-none hover:border-transparent hover:bg-accent-600 active:border-transparent active:bg-accent-700 disabled:border-transparent disabled:bg-accent-500 disabled:text-text-white disabled:opacity-40 sm:col-start-4"
            icon={
              stop || entry.progress.kind === "uploading"
                ? RiStopFill
                : RiArrowUpLine
            }
            aria-label={
              entry.progress.kind === "uploading"
                ? "Cancel image upload"
                : stop
                  ? stop.kind === "home" && scope.kind === "area"
                    ? "Stop Home and routed reply"
                    : current?.thread.run.kind === "running" &&
                        current.thread.run.operation === "compact"
                      ? "Stop compaction"
                      : "Stop reply"
                  : "Send message"
            }
            type={
              stop || entry.progress.kind === "uploading" ? "button" : "submit"
            }
            disabled={
              entry.progress.kind === "uploading"
                ? false
                : stop
                  ? pending || offline
                  : !controller.canSend(scope)
            }
            onClick={
              entry.progress.kind === "uploading"
                ? () => entry.upload?.abort()
                : stop
                  ? () => void controller.stop(scope)
                  : undefined
            }
          />
        </div>
      </form>
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
