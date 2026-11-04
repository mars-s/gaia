import { useId, useState } from "react";
import {
  RiAddLine,
  RiContractLeftRightLine,
  RiHistoryLine,
  RiImageAddLine,
  RiArrowDownSLine,
} from "@remixicon/react";
import {
  Button as AriaButton,
  Dialog,
  DialogTrigger,
  Popover,
  Radio,
  RadioGroup,
} from "react-aria-components";
import {
  Dropdown,
  DropdownTrigger,
  DropdownPopover,
  DropdownItem,
} from "@/components/base/dropdown/dropdown";
import type { Snapshot, ThinkingLevel } from "../../packages/protocol/index.ts";

const effortLabels: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

export function ComposerControls({
  chat,
  disabled,
  onModel,
}: {
  chat: NonNullable<Snapshot["chat"]>;
  disabled: boolean;
  onModel: (modelId: string, thinkingLevel?: ThinkingLevel) => void;
}) {
  const effortId = useId();
  const model = chat.models.find((model) => model.id === chat.modelId);
  const levels = model?.capabilities?.thinkingLevels ?? [];
  const selectedLevel = chat.thinkingLevel;
  return (
    <DialogTrigger>
      <AriaButton
        type="button"
        aria-label={`Model and reasoning effort, ${model?.name ?? chat.modelId}${selectedLevel ? `, ${effortLabels[selectedLevel]}` : ""}`}
        isDisabled={disabled}
        className="model-trigger col-start-2 row-start-2 flex h-9 min-w-0 max-w-44 items-center justify-self-end gap-1 rounded-full px-2 text-caption-1-medium text-text-secondary outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring disabled:opacity-40 sm:col-start-3 sm:row-start-1"
      >
        <span className="truncate">{model?.name ?? chat.modelId}</span>
        <RiArrowDownSLine className="size-4 shrink-0" aria-hidden />
      </AriaButton>
      <Popover placement="top end" offset={12} className="model-popover">
        <Dialog
          aria-label="Model and reasoning effort"
          className="model-dialog outline-none"
        >
          <p className="px-4 pt-3 pb-1 text-caption-1-medium text-text-secondary">
            Models
          </p>
          <RadioGroup
            aria-label="Model"
            value={chat.modelId}
            onChange={(id) => onModel(id)}
            isDisabled={disabled}
            className="model-options"
          >
            {chat.models.map((model) => (
              <Radio key={model.id} value={model.id} className="model-option">
                <span className="min-w-0 wrap-anywhere">{model.name}</span>
                <span className="model-radio" aria-hidden />
              </Radio>
            ))}
          </RadioGroup>
          {levels.length > 1 && selectedLevel ? (
            <div className="effort-controls">
              <label htmlFor={effortId} className="text-body-medium">
                <span className="text-text-secondary">Effort </span>
                {effortLabels[selectedLevel]}
              </label>
              <div
                aria-hidden
                className="mt-3 flex justify-between text-caption-1-regular text-text-secondary"
              >
                <span>Faster</span>
                <span>Smarter</span>
              </div>
              <input
                id={effortId}
                className="effort-range"
                type="range"
                min={0}
                max={levels.length - 1}
                step={1}
                value={Math.max(0, levels.indexOf(selectedLevel))}
                aria-label="Reasoning effort"
                aria-valuetext={effortLabels[selectedLevel]}
                aria-disabled={disabled}
                onChange={(event) => {
                  const level = levels[Number(event.target.value)];
                  if (level && !disabled) onModel(chat.modelId, level);
                }}
              />
              <div aria-hidden className="effort-ticks">
                {levels.map((level) => (
                  <span key={level} data-selected={level === selectedLevel} />
                ))}
              </div>
            </div>
          ) : (
            model?.capabilities && (
              <p className="effort-controls text-caption-1-regular text-text-secondary">
                This model has no adjustable reasoning effort.
              </p>
            )
          )}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}

export function ComposerActions({
  disabled,
  onCompact,
  onHistory,
  onAttach,
}: {
  disabled: boolean;
  onCompact: () => void;
  onHistory?: () => void;
  onAttach?: () => void;
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
        {onAttach && (
          <DropdownItem
            onSelect={() => {
              setOpen(false);
              onAttach();
            }}
          >
            <RiImageAddLine
              className="size-5 text-foreground-icon-secondary"
              aria-hidden
            />
            <span className="text-body-medium">Attach images</span>
          </DropdownItem>
        )}
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
