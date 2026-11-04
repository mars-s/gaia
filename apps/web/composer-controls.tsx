import { Button } from "@/components/base/buttons/button";
import { Select, SelectItem } from "@/components/base/select/select";
import type { Snapshot } from "../../packages/protocol/index.ts";

export function ComposerControls({
  chat,
  disabled,
  onModel,
  onCompact,
}: {
  chat: NonNullable<Snapshot["chat"]>;
  disabled: boolean;
  onModel: (modelId: string) => void;
  onCompact: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        aria-label="Model"
        size="sm"
        className="min-w-0 max-w-44"
        triggerClassName="border-transparent bg-transparent shadow-none hover:border-transparent hover:bg-background-secondary-hover focus-visible:ring-offset-0"
        selectedKey={chat.modelId}
        isDisabled={disabled}
        onSelectionChange={(key) => {
          if (typeof key === "string") onModel(key);
        }}
      >
        {chat.models.map((model) => (
          <SelectItem id={model.id} key={model.id} textValue={model.name}>
            {model.name}
          </SelectItem>
        ))}
      </Select>
      <Button
        className="bg-transparent text-text-secondary shadow-none hover:bg-background-secondary-hover"
        type="button"
        variant="ghost"
        size="small"
        disabled={disabled}
        title="Summarise older context and keep the chat history"
        onClick={onCompact}
      >
        {chat.compaction.kind === "running" ? "Compacting…" : "Compact"}
      </Button>
    </div>
  );
}
