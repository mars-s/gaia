import { modelMenu, readRecentModels, rememberModel } from "./recent-models.ts";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
  Modal,
  ModalOverlay,
  Radio,
  RadioGroup,
} from "react-aria-components";
import { Input } from "./components/base/input/input";
import {
  Dropdown,
  DropdownTrigger,
  DropdownPopover,
  DropdownItem,
} from "@/components/base/dropdown/dropdown";
import type {
  ModelSelection,
  Snapshot,
  ThinkingLevel,
} from "../../packages/protocol/index.ts";

type Model = NonNullable<Snapshot["chat"]>["models"][number];
export const effortLabels: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};
export function contextCount(count: number) {
  if (count < 1000) return String(count);
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${Number((count / 1000000).toFixed(1))}M`;
}
export function modelFacts(model: Model, images: boolean) {
  if (!model.capabilities) return undefined;
  return `${model.capabilities.images ? "Reads images" : images ? "Can’t read your images" : "Text only"}\u202f·\u202f${contextCount(model.contextWindow)} context`;
}
export function modelChoiceFacts(
  model: Model,
  models: Model[],
  images: boolean,
) {
  const facts = modelFacts(model, images);
  if (images && model.capabilities && !model.capabilities.images) return facts;
  const choices = new Set(
    models.map((item) => modelFacts(item, images)).filter(Boolean),
  );
  return choices.size > 1 ? facts : undefined;
}
export function effortText(
  model: Model | undefined,
  level: ThinkingLevel | undefined,
) {
  if (!model) return "Not available now";
  const levels = model.capabilities?.thinkingLevels ?? [];
  return levels.length <= 1
    ? undefined
    : level && levels.includes(level)
      ? effortLabels[level]
      : "Choose effort";
}
export function filterModels(models: Model[], query: string) {
  const text = query.toLocaleLowerCase();
  return models.filter(
    (model) =>
      model.name.toLocaleLowerCase().includes(text) ||
      model.id.toLocaleLowerCase().includes(text),
  );
}

export function ComposerControls({
  chat,
  disabled,
  onSelect,
  selection,
  hasImages = false,
}: {
  chat: NonNullable<Snapshot["chat"]>;
  disabled: boolean;
  onSelect: (selection: ModelSelection) => void;
  selection?: ModelSelection;
  hasImages?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [menuSelection, setMenuSelection] = useState<string>();
  const [recent, setRecent] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const trigger = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const modelScroll = useRef<HTMLDivElement>(null);
  const recentPicks = useRef<string[]>([]);
  const knownNames = useRef(new Map<string, string>());
  const typeahead = useRef({ text: "", time: 0 });
  const modelId = selection?.modelId ?? chat.modelId;
  const model = chat.models.find((item) => item.id === modelId);
  const selectedLevel = selection
    ? selection.thinkingLevel
    : chat.thinkingLevel;
  const name = model?.name ?? knownNames.current.get(modelId) ?? modelId;
  const loading = chat.models.length === 0;
  const levelText = loading ? undefined : effortText(model, selectedLevel);
  const { primary, remaining } = modelMenu(
    chat.models,
    open ? (menuSelection ?? modelId) : modelId,
    recent,
  );
  const searchable = chat.models.length >= 13;
  const matches = filterModels(chat.models, query);
  useEffect(() => {
    for (const item of chat.models) knownNames.current.set(item.id, item.name);
  }, [chat.models]);
  useEffect(() => {
    const media = matchMedia("(max-width: 639px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!open || narrow) return;
    function dismissOutside(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        !popover.current?.contains(target) &&
        !trigger.current?.contains(target)
      )
        setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside, true);
    return () =>
      document.removeEventListener("pointerdown", dismissOutside, true);
  }, [open, narrow]);
  function updateEdges() {
    const node = modelScroll.current;
    if (node)
      setEdges({
        top: node.scrollTop > 1,
        bottom: node.scrollTop + node.clientHeight < node.scrollHeight - 1,
      });
  }
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      if (searchable) search.current?.focus();
      else {
        const selected = dialog.current?.querySelector<HTMLElement>(
          `.model-option[data-model-id="${CSS.escape(modelId)}"]:not([data-disabled]) input`,
        );
        (
          selected ??
          dialog.current?.querySelector<HTMLElement>(
            ".model-option:not([data-disabled]) input",
          )
        )?.focus();
      }
      updateEdges();
    });
    const observer = new ResizeObserver(updateEdges);
    if (modelScroll.current) observer.observe(modelScroll.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, searchable]);
  function changeOpen(next: boolean) {
    if (next) {
      anchor.current = trigger.current?.closest("form") ?? trigger.current;
      recentPicks.current = readRecentModels();
      setRecent(recentPicks.current);
      setMenuSelection(modelId);
      setQuery("");
      setExpanded(false);
      typeahead.current = { text: "", time: 0 };
    }
    setOpen(next);
  }
  function selectModel(id: string) {
    const item = chat.models.find((item) => item.id === id);
    if (!item || disabled) return;
    const supported = item.capabilities?.thinkingLevels ?? [];
    recentPicks.current = rememberModel(id, recentPicks.current);
    onSelect({
      modelId: id,
      thinkingLevel:
        selectedLevel && supported.includes(selectedLevel)
          ? selectedLevel
          : supported.includes("medium")
            ? "medium"
            : supported[0],
    });
  }
  function modelKeys(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLElement)) return;
    const rows = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        ".model-option:not([data-disabled]), .model-all-toggle",
      ) ?? []),
    ];
    const current = event.target.closest<HTMLElement>(
      ".model-option, .model-all-toggle",
    );
    if (!current) return;
    let index = rows.indexOf(current);
    if (event.key === "Enter" && current.classList.contains("model-option")) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
              rows.length;
      const next = rows[index];
      (next?.querySelector<HTMLInputElement>("input") ?? next)?.focus();
      if (next?.dataset.modelId) selectModel(next.dataset.modelId);
    } else if (
      event.key.length === 1 &&
      event.key !== " " &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (searchable) {
        setQuery(query + event.key);
        search.current?.focus();
        return;
      }
      const now = Date.now();
      typeahead.current = {
        text:
          (now - typeahead.current.time > 500 ? "" : typeahead.current.text) +
          event.key.toLocaleLowerCase(),
        time: now,
      };
      const next = [...rows.slice(index + 1), ...rows.slice(0, index + 1)].find(
        (row) =>
          row.dataset.modelName
            ?.toLocaleLowerCase()
            .split(/[ -]/)
            .some((word) => word.startsWith(typeahead.current.text)),
      );
      (next?.querySelector<HTMLInputElement>("input") ?? next)?.focus();
      if (next?.dataset.modelId) selectModel(next.dataset.modelId);
    }
  }
  function dialogKeys(event: KeyboardEvent) {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
      search.current?.focus();
    }
    if (event.key === "Tab") {
      const nodes = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'input:not([tabindex="-1"]), button:not([disabled]), summary, [role="radio"][tabindex="0"]',
        ) ?? []),
      ].filter((node) => node.getClientRects().length);
      nodes.sort(
        (a, b) =>
          Number(a.classList.contains("model-done")) -
          Number(b.classList.contains("model-done")),
      );
      const index = nodes.findIndex((node) => node === document.activeElement);
      const next =
        nodes[
          (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length
        ];
      if (next) {
        event.preventDefault();
        event.stopPropagation();
        next.focus();
      }
    }
  }
  function row(item: (typeof primary)[number]) {
    const real = chat.models.find((model) => model.id === item.id);
    const facts = real
      ? modelChoiceFacts(real, chat.models, hasImages)
      : "Not available now";
    return (
      <Radio
        key={item.id}
        value={item.id}
        autoFocus={
          !searchable &&
          (item.id === modelId || (!model && item.id === chat.models[0]?.id))
        }
        isDisabled={!real}
        className="model-option"
        data-model-id={item.id}
        data-model-name={
          real?.name ?? knownNames.current.get(item.id) ?? item.name
        }
      >
        <span className="model-row-text">
          <span className="model-name">
            {real?.name ?? knownNames.current.get(item.id) ?? item.name}
          </span>
          {facts && <span className="model-facts">{facts}</span>}
        </span>
        <span className="model-radio" aria-hidden />
      </Radio>
    );
  }
  const content = (
    <Dialog
      aria-label="Model and reasoning effort"
      className="model-dialog outline-none"
    >
      <div
        ref={dialog}
        className="model-dialog-body"
        onKeyDownCapture={dialogKeys}
      >
        {narrow && (
          <div className="model-sheet-header">
            <span>Model and effort</span>
            <AriaButton
              className="secondary-action model-done"
              onPress={() => setOpen(false)}
            >
              Done
            </AriaButton>
          </div>
        )}
        {loading ? (
          <p className="model-loading">Loading models…</p>
        ) : (
          <>
            {searchable && (
              <div className="model-search">
                <Input
                  ref={search}
                  aria-label="Find a model"
                  placeholder="Find a model"
                  value={query}
                  onChange={setQuery}
                />
                {query && (
                  <AriaButton
                    aria-label="Clear search"
                    className="quiet-action model-search-clear"
                    onPress={() => {
                      setQuery("");
                      search.current?.focus();
                    }}
                  >
                    ×
                  </AriaButton>
                )}
              </div>
            )}
            <div
              className="model-scroll-frame"
              data-clipped-top={edges.top}
              data-clipped-bottom={edges.bottom}
            >
              <div
                className="model-options"
                ref={modelScroll}
                onScroll={updateEdges}
              >
                <div onKeyDownCapture={modelKeys}>
                  <RadioGroup
                    aria-label="Model"
                    value={modelId}
                    onChange={selectModel}
                    isDisabled={disabled}
                    className="model-radio-group"
                  >
                    {query ? (
                      <>
                        <p className="model-section">
                          Matches ({matches.length})
                        </p>
                        {!model &&
                          primary
                            .filter((item) => item.id === modelId)
                            .map(row)}
                        {matches.map(row)}
                        {matches.length === 0 && (
                          <p className="model-empty">No model matches.</p>
                        )}
                      </>
                    ) : (
                      <>
                        {chat.models.length > 6 && (
                          <p className="model-section">Recent</p>
                        )}
                        {primary.map(row)}
                        {remaining.length > 0 && (
                          <>
                            <AriaButton
                              className="quiet-action model-all-toggle"
                              aria-expanded={expanded}
                              onPress={() => setExpanded(!expanded)}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "ArrowRight" ||
                                  event.key === "ArrowLeft"
                                ) {
                                  event.preventDefault();
                                  setExpanded(event.key === "ArrowRight");
                                }
                              }}
                            >
                              <RiArrowDownSLine
                                className="size-4"
                                aria-hidden
                              />
                              All models ({remaining.length})
                            </AriaButton>
                            {expanded && remaining.map(row)}
                          </>
                        )}
                      </>
                    )}
                  </RadioGroup>
                </div>
              </div>
            </div>
            {model && (
              <EffortControls
                model={model}
                level={selectedLevel}
                disabled={disabled}
                onSelect={(thinkingLevel) =>
                  onSelect({ modelId, thinkingLevel })
                }
              />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
  return (
    <DialogTrigger isOpen={open} onOpenChange={changeOpen}>
      <AriaButton
        data-loading={loading}
        ref={trigger}
        type="button"
        aria-label={`Model and reasoning effort, ${loading ? "Loading models…" : name}${levelText ? `, ${levelText}` : ""}`}
        isDisabled={disabled}
        onKeyDown={(event) => {
          if (event.altKey && event.key === "ArrowDown") {
            event.preventDefault();
            changeOpen(true);
          }
        }}
        className="quiet-action model-trigger col-start-2 row-start-2 flex min-w-0 items-center justify-self-end gap-1 sm:col-start-3 sm:row-start-1"
      >
        <span className="model-trigger-name">
          {loading ? "Loading models…" : name}
        </span>
        {levelText && (
          <span className="model-trigger-effort"><span className="model-trigger-separator">{"\u2009·\u2009"}</span>{levelText}</span>
        )}
        <RiArrowDownSLine className="size-4 shrink-0" aria-hidden />
      </AriaButton>
      {narrow ? (
        <ModalOverlay isDismissable className="model-scrim">
          <Modal
            className="model-sheet"
            style={{
              minHeight: anchor.current
                ? Math.min(
                    innerHeight * 0.8,
                    innerHeight - anchor.current.getBoundingClientRect().top,
                  )
                : undefined,
            }}
          >
            {content}
          </Modal>
        </ModalOverlay>
      ) : (
        <Popover
          ref={popover}
          triggerRef={anchor}
          placement="top end"
          offset={8}
          isNonModal
          className="model-popover"
        >
          {content}
        </Popover>
      )}
    </DialogTrigger>
  );
}

export function EffortControls({
  model,
  level,
  disabled,
  onSelect,
}: {
  model: Model;
  level?: ThinkingLevel;
  disabled: boolean;
  onSelect(level: ThinkingLevel): void;
}) {
  const levels = model.capabilities?.thinkingLevels ?? [];
  const adjustable = levels.length > 1;
  const valid = level && levels.includes(level);
  return (
    <div className="effort-controls">
      <p className="effort-header">
        <span>Effort</span>

      </p>
      {adjustable ? (
        <>
          <div
            onKeyDownCapture={(event) => {
              if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                const choice = event.key === "Home" ? levels[0] : levels.at(-1);
                if (choice) {
                  onSelect(choice);
                  const radios =
                    event.currentTarget.querySelectorAll<HTMLElement>(
                      "input[type=radio]",
                    );
                  radios[event.key === "Home" ? 0 : radios.length - 1]?.focus();
                }
              }
            }}
          >
            <RadioGroup
              aria-label="Effort, faster to smarter"
              orientation="horizontal"
              value={valid ? level : ""}
              onChange={(value) => {
                const choice = levels.find((level) => level === value);
                if (choice) onSelect(choice);
              }}
              isDisabled={disabled}
              className="effort-segments"
              data-count={levels.length}
            >
              {levels.map((level) => (
                <Radio key={level} value={level} className="effort-cell">
                  {effortLabels[level]}
                </Radio>
              ))}
            </RadioGroup>
          </div>
          <div className="effort-ends" aria-hidden>
            <span>Faster</span>
            <span>Smarter</span>
          </div>
          {!valid && (
            <p className="effort-caption">
              Choose one. {model.name} doesn’t offer the last level you used.
            </p>
          )}
        </>
      ) : (
        <p className="effort-caption">
          Not adjustable. {model.name} has one fixed effort level.
        </p>
      )}
    </div>
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
        className="quiet-action flex size-9 shrink-0 items-center justify-center self-end rounded-full bg-transparent text-text-primary transition-colors hover:bg-background-secondary-hover disabled:opacity-40"
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
