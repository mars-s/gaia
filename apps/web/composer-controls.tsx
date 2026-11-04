import { useState } from "react";
import {
  RiAddLine,
  RiContractLeftRightLine,
  RiHistoryLine,
} from "@remixicon/react";
import {
  Dropdown,
  DropdownTrigger,
  DropdownPopover,
  DropdownItem,
} from "@/components/base/dropdown/dropdown";
import { Select, SelectItem } from "@/components/base/select/select";
import type { Snapshot } from "../../packages/protocol/index.ts";

export function ComposerControls({
  chat,
  disabled,
  onModel,
}: {
  chat: NonNullable<Snapshot["chat"]>;
  disabled: boolean;
  onModel: (modelId: string) => void;
}) {
  return (
    <Select
      aria-label="Model"
      size="sm"
      className="col-start-2 row-start-2 min-w-0 max-w-40 sm:col-start-3 sm:row-start-1"
      triggerClassName="border-transparent bg-transparent text-text-secondary shadow-none hover:border-transparent hover:bg-background-secondary-hover focus-visible:ring-offset-0"
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
  );
}

export function ComposerActions({
  disabled,
  onCompact,
  onHistory,
}: {
  disabled: boolean;
  onCompact: () => void;
  onHistory?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger
        type="button"
        aria-label="Chat actions"
        isDisabled={disabled}
        className="flex size-9 shrink-0 items-center justify-center self-end rounded-full bg-background-tertiary-hover text-text-primary transition-colors hover:bg-background-secondary-hover disabled:opacity-40"
      >
        <RiAddLine className="size-5" aria-hidden />
      </DropdownTrigger>
      <DropdownPopover aria-label="Chat actions" placement="top start">
        <DropdownItem
          onSelect={() => {
            setOpen(false);
            onCompact();
          }}
        >
          <RiContractLeftRightLine
            className="size-5 text-foreground-icon-secondary"
            aria-hidden
          />
          <span className="text-body-medium">Compact context</span>
        </DropdownItem>
        {onHistory && (
          <DropdownItem
            onSelect={() => {
              setOpen(false);
              onHistory();
            }}
          >
            <RiHistoryLine
              className="size-5 text-foreground-icon-secondary"
              aria-hidden
            />
            <span className="text-body-medium">Change history</span>
          </DropdownItem>
        )}
      </DropdownPopover>
    </Dropdown>
  );
}
