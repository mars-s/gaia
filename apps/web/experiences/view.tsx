import { useEffect, useRef, useState } from "react";
import { RiArrowUpLine, RiHashtag, RiMenuLine } from "@remixicon/react";
import { Button } from "../components/base/buttons/button";
import { IconButton } from "../components/base/buttons/icon-button";
import { Textarea } from "../components/base/textarea/textarea";
import { ComposerActions, ComposerControls } from "../composer-controls";
import { DraftImages } from "../image-previews";
import { MessageMarkdown } from "../transcript";
import { cx } from "../utils/cx";
import type { ExperienceJob } from "../../../packages/protocol/experiences.ts";
import {
  keyboardSend,
  jobActive,
  experienceKey,
  type ExperienceController,
  type Scope,
} from "./controller";

export function ExperienceConversation({
  controller,
  onProfiles,
}: {
  controller: ExperienceController;
  onProfiles?: () => void;
}) {
  const profile = controller.profile;
  const scope = controller.selected;
  const [navigation, setNavigation] = useState(false);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [purpose, setPurpose] = useState("");
  const [creating, setCreating] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  if (!profile || !scope)
    return (
      <p role="status" className="p-6 text-text-secondary">
        Loading conversation…
      </p>
    );
  const layout = profile.profile.plan.layout;
  const collection = {
    single: "Conversation",
    bots: "Bots",
    channels: "Channels",
    sessions: "Sessions",
  }[layout];
  const newLabel = {
    single: "",
    bots: "New Bot",
    channels: "New channel",
    sessions: "New session",
  }[layout];
  const selected = profile.scopes.find((item) => item.id === scope.scopeId);
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col sm:flex-row">
      {layout !== "single" && (
        <>
          <div className="px-4 sm:hidden">
            <Button
              ref={toggle}
              variant="ghost"
              size="small"
              onClick={() => setNavigation(!navigation)}
              aria-expanded={navigation}
              aria-controls="experience-navigation"
            >
              <RiMenuLine className="size-4" />
              {collection}
            </Button>
          </div>
          <nav
            id="experience-navigation"
            aria-label={collection}
            className={cx(
              "shrink-0 overflow-y-auto border-border-secondary p-3 sm:block sm:w-52 sm:border-r",
              navigation ? "block" : "hidden",
            )}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setNavigation(false);
                toggle.current?.focus();
              }
            }}
          >
            {layout === "channels" && (
              <p className="px-3 py-2 text-body-medium">
                {profile.profile.plan.assistantName}
              </p>
            )}
            <div className="flex flex-col gap-1">
              {profile.scopes.map((item) => (
                <Button
                  key={item.id}
                  variant="ghost"
                  size="small"
                  className={cx(
                    "w-full justify-start",
                    item.id === scope.scopeId &&
                      "bg-background-secondary-default",
                  )}
                  aria-current={item.id === scope.scopeId ? "page" : undefined}
                  onClick={() => {
                    controller.select({
                      profileId: scope.profileId,
                      scopeId: item.id,
                    });
                    setNavigation(false);
                  }}
                >
                  {layout === "bots" && <BotAvatar avatar={item.avatar} />}
                  {layout === "channels" && (
                    <RiHashtag className="size-4 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{item.label}</span>
                </Button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="small"
              className="mt-4"
              disabled={creating}
              onClick={() => {
                if (layout === "sessions") {
                  setCreating(true);
                  void controller
                    .createScope("New session", profile.profile.plan.purpose)
                    .finally(() => setCreating(false));
                } else setAdding(!adding);
              }}
            >
              {newLabel}
            </Button>
            {adding && (
              <form
                className="mt-3 flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (creating) return;
                  setCreating(true);
                  void controller
                    .createScope(label, purpose)
                    .then((ok) => {
                      if (!ok) return;
                      setAdding(false);
                      setLabel("");
                      setPurpose("");
                    })
                    .finally(() => setCreating(false));
                }}
              >
                <label className="text-caption-1-regular">
                  Name
                  <input
                    className="w-full rounded-lg bg-background-tertiary-default p-2"
                    maxLength={100}
                    required
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  />
                </label>
                <label className="text-caption-1-regular">
                  Purpose
                  <textarea
                    className="w-full rounded-lg bg-background-tertiary-default p-2"
                    required
                    maxLength={4000}
                    value={purpose}
                    onChange={(event) => setPurpose(event.target.value)}
                  />
                </label>
                <Button
                  type="submit"
                  variant="secondary"
                  size="small"
                  disabled={creating}
                >
                  Create
                </Button>
              </form>
            )}
          </nav>
        </>
      )}
      <section
        className="flex min-h-0 min-w-0 flex-1 flex-col"
        aria-label={selected?.label ?? "Conversation"}
      >
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-2 text-caption-1-regular text-text-secondary sm:px-8">
          {layout === "bots" && <BotAvatar avatar={selected?.avatar} />}
          <span className="truncate">
            {layout === "bots"
              ? selected?.label
              : profile.profile.plan.assistantName}
            {layout !== "single" && layout !== "bots"
              ? ` · ${selected?.label}`
              : ""}
          </span>
          {layout === "channels" && (
            <span className="ml-auto">Shared memory, separate threads</span>
          )}
          {onProfiles && (
            <button
              className="quiet-link ml-auto shrink-0"
              onClick={onProfiles}
            >
              Profiles
            </button>
          )}
        </div>
        <ScopeConversation
          key={experienceKey(scope)}
          controller={controller}
          scope={scope}
        />
      </section>
    </main>
  );
}

function ScopeConversation({
  controller,
  scope,
}: {
  controller: ExperienceController;
  scope: Scope;
}) {
  const entry = controller.entry(scope);
  const state = entry.state;
  const [announcement, setAnnouncement] = useState("");
  const announcer = useRef<ReturnType<typeof createActivityAnnouncer> | null>(
    null,
  );
  useEffect(() => {
    const current = createActivityAnnouncer(setAnnouncement);
    announcer.current = current;
    return () => {
      current.dispose();
      announcer.current = null;
    };
  }, []);
  useEffect(() => {
    announcer.current?.update(state?.jobs ?? []);
  }, [state?.jobs]);
  const saved = entry.draft.read();
  const draft = saved.kind === "ready" ? saved.draft : undefined;
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const model = state?.chat.models.find(
    (item) => item.id === (entry.selection?.modelId ?? state.chat.modelId),
  );
  useEffect(() => {
    input.current?.focus();
    return () => {
      entry.composing = false;
    };
  }, [entry]);
  useEffect(() => {
    if (follow.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [state]);
  const send = () => {
    follow.current = true;
    void controller.send(scope);
  };
  return (
    <>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const el = event.currentTarget;
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 96;
        }}
      >
        <div
          className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-8"
          role="log"
          aria-live="off"
          aria-label="Conversation"
        >
          {!state ? (
            <p role="status" className="text-text-secondary">
              Loading conversation…
            </p>
          ) : !state.messages.length ? (
            <h1 className="py-12 text-center text-title-3-semibold">
              What’s on your mind?
            </h1>
          ) : (
            state.messages.map((message) => {
              const jobs = state.jobs.filter(
                (job) =>
                  (state.messages.some((item) => item.id === job.answerId)
                    ? job.answerId === message.id
                    : job.messageId === message.id) && !job.parentId,
              );
              return (
                <div key={message.id} className="flex min-w-0 flex-col gap-3">
                  <article
                    aria-label={
                      message.role === "user"
                        ? "You"
                        : controller.profile?.profile.plan.assistantName
                    }
                    className={cx(
                      "message-text min-w-0 wrap-anywhere",
                      message.role === "user"
                        ? "max-w-[88%] self-end rounded-3xl bg-background-secondary-default px-5 py-3"
                        : "w-full max-w-[72ch]",
                    )}
                  >
                    {message.attachments?.map((image) => (
                      <img
                        key={image.id}
                        src={controller.client.attachmentUrl(
                          scope.profileId,
                          scope.scopeId,
                          image.id,
                        )}
                        alt={image.name}
                        className="mb-2 max-h-60 max-w-full rounded-xl"
                        loading="lazy"
                      />
                    ))}
                    {message.role === "user" ? (
                      <span className="whitespace-pre-wrap">
                        {message.text}
                      </span>
                    ) : (
                      <MessageMarkdown text={message.text} />
                    )}
                  </article>
                  {jobs.map((job) => (
                    <JobRows
                      key={job.id}
                      job={job}
                      controller={controller}
                      scope={scope}
                    />
                  ))}
                </div>
              );
            })
          )}
          {state?.jobs
            .filter(
              (job) =>
                job.parentId ||
                !state.messages.some((message) => message.id === job.messageId),
            )
            .map((job) => (
              <JobRows
                key={job.id}
                job={job}
                controller={controller}
                scope={scope}
              />
            ))}
          <div ref={bottom} />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-3 px-4 pt-3 pb-5 sm:px-8 sm:pb-8">
        {(entry.error || controller.error) && (
          <p role="alert" className="text-text-error-primary">
            {entry.error || controller.error}
          </p>
        )}
        {entry.offline && (
          <p role="status" className="text-text-secondary">
            Connection lost. Reconnecting… Your draft is here.
          </p>
        )}
        {saved.kind === "error" && (
          <p role="alert">
            {saved.message}{" "}
            <button
              className="quiet-link"
              onClick={() => void entry.draft.load()}
            >
              Retry draft
            </button>
          </p>
        )}
        {saved.kind === "ready" && saved.durability === "memory" && (
          <p role="alert" className="text-text-secondary">
            Your draft is kept in this window. Storage is unavailable.{" "}
            <button
              className="quiet-link"
              onClick={() => entry.draft.retrySave()}
            >
              Retry saving
            </button>
          </p>
        )}
        {entry.reading > 0 && (
          <p role="status" className="text-text-secondary">
            Reading images…
          </p>
        )}
        {!!draft?.images.length && !model?.capabilities?.images && (
          <p role="alert" className="text-text-secondary">
            {model
              ? "Choose an image-capable model or remove the images to send."
              : "Choose an available model to send. Your draft and images are here."}
          </p>
        )}
        <form
          aria-label="Message assistant"
          className="composer flex flex-col gap-2 rounded-[28px] bg-background-tertiary-default p-2"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files);
            if (files.length) {
              event.preventDefault();
              void controller.addImages(scope, files);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files"))
              event.preventDefault();
          }}
          onDrop={(event) => {
            if (event.dataTransfer.files.length) {
              event.preventDefault();
              void controller.addImages(
                scope,
                Array.from(event.dataTransfer.files),
              );
            }
          }}
        >
          {!!draft?.images.length && (
            <DraftImages
              images={draft.images}
              onRemove={(id) =>
                entry.draft.update((value) => ({
                  ...value,
                  images: value.images.filter((image) => image.id !== id),
                }))
              }
            />
          )}
          <input
            ref={file}
            type="file"
            className="hidden"
            aria-label="Choose images"
            accept="image/png,image/jpeg,image/webp"
            multiple
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
              disabled={!state || entry.offline || entry.actions.has("compact")}
              onAttach={
                model?.capabilities?.images && draft
                  ? () => file.current?.click()
                  : undefined
              }
              onCompact={() => void controller.compact(scope)}
            />
            <Textarea
              ref={input}
              className="col-start-2 row-start-1 min-w-0"
              fieldClassName="rounded-2xl bg-transparent ring-0 hover:ring-0 focus-within:ring-0"
              aria-label="Message assistant"
              autoResize
              maxRows={8}
              rows={1}
              maxLength={32000}
              value={draft?.text ?? ""}
              isDisabled={!draft}
              onChange={(text) =>
                entry.draft.update((value) => ({ ...value, text }))
              }
              onCompositionStart={() => controller.compose(scope, true)}
              onCompositionEnd={() => controller.compose(scope, false)}
              onKeyDown={(event) => {
                if (
                  keyboardSend({
                    key: event.key,
                    shiftKey: event.shiftKey,
                    isComposing: event.nativeEvent.isComposing,
                    keyCode: event.keyCode,
                  })
                ) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder="Ask me anything…"
            />
            {state && (
              <ComposerControls
                chat={state.chat}
                disabled={entry.offline}
                selection={entry.selection}
                onSelect={(selection) =>
                  controller.selectModel(scope, selection)
                }
              />
            )}
            <IconButton
              type="submit"
              icon={RiArrowUpLine}
              aria-label="Send message"
              className="col-start-3 row-start-1 shrink-0 self-end rounded-full border-transparent bg-accent-500 text-text-white shadow-none hover:border-transparent hover:bg-accent-600 active:border-transparent active:bg-accent-700 disabled:border-transparent disabled:bg-accent-500 disabled:text-text-white disabled:opacity-40 sm:col-start-4"
              disabled={!controller.canSend(scope)}
            />
          </div>
        </form>
        {state?.chat.compaction.kind !== "idle" &&
          state?.chat.compaction.message && (
            <p
              role="status"
              className="text-caption-1-regular text-text-secondary"
            >
              {state.chat.compaction.message}
            </p>
          )}
      </div>
    </>
  );
}

export function createActivityAnnouncer(
  announce: (description: string) => void,
) {
  let descriptions = new Map<string, string>();
  let latest = "";
  let spoken = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    update(jobs: ExperienceJob[]) {
      const next = new Map<string, string>();
      let changed: string | undefined;
      for (const job of jobs) {
        if (job.state.kind !== "running" && job.state.kind !== "stopping")
          continue;
        for (const activity of job.state.activity) {
          if (!activity.description.trim()) continue;
          const key = `${job.id}/${activity.id}`;
          next.set(key, activity.description);
          if (descriptions.get(key) !== activity.description)
            changed = activity.description;
        }
      }
      descriptions = next;
      const candidate =
        changed ?? (Array.from(next.values()).includes(latest) ? latest : "");
      if (candidate === latest) return;
      latest = candidate;
      cancel();
      if (!latest) {
        announce("");
      } else if (latest !== spoken) {
        const description = latest;
        timer = setTimeout(() => {
          spoken = description;
          announce(description);
          timer = undefined;
        }, 1000);
      }
    },
    dispose: cancel,
  };
}

function JobRows({
  job,
  controller,
  scope,
}: {
  job: ExperienceJob;
  controller: ExperienceController;
  scope: Scope;
}) {
  const [confirm, setConfirm] = useState(false);
  const state = job.state;
  const entry = controller.entry(scope);
  const profile = controller.profile;
  const avatar =
    profile?.profile.plan.layout === "bots"
      ? profile.scopes.find((item) => item.id === job.scopeId)?.avatar
      : undefined;
  const activities =
    state.kind === "running" || state.kind === "stopping"
      ? state.activity.filter((activity) => activity.description.trim())
      : [];
  const assistantAvatar =
    profile?.profile.plan.layout === "bots" ? (
      <BotAvatar avatar={avatar} />
    ) : (
      <span className="gaia-mark" aria-hidden="true" />
    );
  if (state.kind === "completed")
    return state.citations.length ? (
      <ul
        aria-label="Sources"
        className="flex flex-wrap gap-3 text-caption-1-regular text-text-secondary"
      >
        {state.citations.map((citation) => (
          <li key={citation.url}>
            <a
              className="quiet-link"
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
            >
              {citation.title || citation.url}
            </a>
          </li>
        ))}
      </ul>
    ) : null;
  return (
    <div className="job-progress flex min-w-0 flex-col gap-2 text-caption-1-regular text-text-secondary">
      {activities.map((activity) => (
        <div key={activity.id} className="flex min-w-0 items-center gap-2">
          {assistantAvatar}
          <span className="min-w-0 truncate" title={activity.description}>
            {activity.description}
          </span>
        </div>
      ))}
      <div className="flex min-w-0 items-center gap-2">
        {!activities.length &&
          (state.kind === "queued" ||
            state.kind === "running" ||
            state.kind === "stopping") && (
            <span
              className={cx(state.kind !== "stopping" && "job-avatar-pulse")}
              aria-hidden="true"
            >
              {assistantAvatar}
            </span>
          )}
        {state.kind !== "queued" &&
          state.kind !== "running" &&
          state.kind !== "stopping" && (
            <span>
              {job.title} ·{" "}
              {state.kind === "failed" || state.kind === "uncertain"
                ? state.message
                : state.kind === "interrupted"
                  ? "Interrupted. Not repeated automatically."
                  : "Stopped"}
            </span>
          )}
        {jobActive(job) ? (
          <button
            className="quiet-link"
            disabled={entry.actions.has(job.id) || state.kind === "stopping"}
            aria-label={`Stop ${job.title}`}
            onClick={() => void controller.stop(scope, job)}
          >
            Stop
          </button>
        ) : (
          <button
            className="quiet-link"
            disabled={entry.actions.has(job.id)}
            onClick={() =>
              state.kind === "uncertain" || job.dispatchedEffect
                ? setConfirm(true)
                : void controller.retry(scope, job)
            }
          >
            Try again
          </button>
        )}
      </div>
      {confirm && (
        <RetryConfirmation
          uncertain={state.kind === "uncertain"}
          disabled={entry.actions.has(job.id)}
          onConfirm={() => {
            setConfirm(false);
            void controller.retry(
              scope,
              job,
              state.kind === "uncertain",
              state.kind !== "uncertain",
            );
          }}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
export function BotAvatar({ avatar = "bot-00" }: { avatar?: string }) {
  const local = /^bot-0[0-7]$/.test(avatar) ? avatar : "bot-00";
  return <img src={`/bots/${local}.svg`} alt="" className="size-7 shrink-0" />;
}

export function RetryConfirmation({
  uncertain,
  disabled,
  onConfirm,
  onCancel,
}: {
  uncertain: boolean;
  disabled: boolean;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p>
        {uncertain
          ? "This action may already have happened. Trying again could repeat it."
          : "Gaia already started an action in this attempt. Trying again runs the whole request again, so that action may happen twice."}
      </p>
      <button className="quiet-link" disabled={disabled} onClick={onConfirm}>
        {uncertain ? "Repeat action" : "Run it again"}
      </button>
      <button className="quiet-link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
