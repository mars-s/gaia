import { useRef, useState } from "react";
import { RiArrowUpLine, RiStopFill } from "@remixicon/react";
import { IconButton } from "./components/base/buttons/icon-button";
import { Textarea } from "./components/base/textarea/textarea";
import { DraftImages } from "./image-previews";
import { ComposerActions, ComposerControls } from "./composer-controls";
import { cx } from "./utils/cx";
import type { ImageUpload } from "../../packages/protocol/attachments.ts";
import type {
  ModelSelection,
  Snapshot,
} from "../../packages/protocol/index.ts";

type ComposerProps = {
  label: string;
  placeholder: string;
  draft: string;
  images: ImageUpload[];
  ready: boolean;
  supportsImages: boolean;
  actionsDisabled: boolean;
  modelDisabled: boolean;
  canSend: boolean;
  chat?: Snapshot["chat"];
  selection?: ModelSelection;
  stopLabel?: string;
  stopDisabled?: boolean;
  onStop?: () => void;
  onChange(text: string): void;
  onRemove(id: string): void;
  onImages(files: File[]): void;
  onCompose(composing: boolean): void;
  onCompact(): void;
  onHistory?: () => void;
  onSelect(selection: ModelSelection): void;
  onSend(): void;
};

export function SharedComposer({
  label,
  placeholder,
  draft,
  images,
  ready,
  supportsImages,
  actionsDisabled,
  modelDisabled,
  canSend,
  chat,
  selection,
  stopLabel = "Stop reply",
  stopDisabled,
  onStop,
  onChange,
  onRemove,
  onImages,
  onCompose,
  onCompact,
  onHistory,
  onSelect,
  onSend,
}: ComposerProps) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  function send() {
    if (canSend) onSend();
  }
  return (
    <form
      className={cx(
        "composer flex flex-col gap-2 p-2",
        dragging && "composer-dragging",
      )}
      aria-label={label}
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
        onImages(Array.from(event.dataTransfer.files));
      }}
      onPaste={(event) => {
        const files = Array.from(event.clipboardData.files);
        if (!files.length) return;
        event.preventDefault();
        onImages(files);
        const text = event.clipboardData.getData("text/plain");
        const start = input.current?.selectionStart ?? draft.length;
        const end = input.current?.selectionEnd ?? start;
        if (text)
          onChange(
            (draft.slice(0, start) + text + draft.slice(end)).slice(0, 32000),
          );
      }}
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {images.length > 0 && <DraftImages images={images} onRemove={onRemove} />}
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
        disabled={!supportsImages || !ready}
        onChange={(event) => {
          onImages(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
        <ComposerActions
          disabled={actionsDisabled}
          onAttach={
            supportsImages && ready ? () => file.current?.click() : undefined
          }
          onCompact={onCompact}
          onHistory={onHistory}
        />
        <Textarea
          ref={input}
          className="col-start-2 row-start-1 w-full min-w-0"
          fieldClassName="rounded-2xl bg-transparent ring-0 hover:ring-0 focus-within:ring-0"
          inputClassName="placeholder:text-text-secondary focus:placeholder:text-text-secondary"
          aria-label={label}
          rows={1}
          autoResize
          maxRows={10}
          maxLength={32000}
          value={draft}
          isDisabled={!ready}
          onChange={onChange}
          onCompositionStart={() => onCompose(true)}
          onCompositionEnd={() => onCompose(false)}
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
          placeholder={placeholder}
        />
        {chat && (
          <ComposerControls
            chat={chat}
            disabled={modelDisabled}
            selection={selection}
            onSelect={onSelect}
          />
        )}
        <IconButton
          className={cx(
            "composer-send col-start-3 row-start-1 shrink-0 self-end rounded-full shadow-none sm:col-start-4",
            onStop && "composer-stop",
          )}
          icon={onStop ? RiStopFill : RiArrowUpLine}
          aria-label={onStop ? stopLabel : "Send message"}
          type={onStop ? "button" : "submit"}
          disabled={onStop ? stopDisabled : !canSend}
          onClick={onStop}
        />
      </div>
    </form>
  );
}
