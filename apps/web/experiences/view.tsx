import { setupContext, sessionRecency } from "../setup-context";
import { SetupGlyph } from "../setup-glyph";
import { useTranscriptFollow } from "../use-transcript-follow";
import { EmptyChat } from "../empty-chat";
import { AssistantHead } from "../assistant-head";
import { Dialog } from "@base-ui/react/dialog";
import { CopyButton } from "../copy-button";
import {
  ProgressRow,
  replyError,
  OfflineNotice,
  FailurePath,
} from "../progress-row";
import { SharedComposer } from "../shared-composer";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  RiMenuLine,
  RiAddLine,
} from "@remixicon/react";
import { Button } from "../components/base/buttons/button";
import { MessageMarkdown } from "../transcript";
import { cx } from "../utils/cx";
import type { ExperienceJob } from "../../../packages/protocol/experiences.ts";
import {
  jobActive,
  experienceKey,
  type ExperienceController,
  type Scope,
} from "./controller";

export function ExperienceConversation({
  controller,
  switcher,
  accountControl,
  onSettings,
  onOriginal,
}: {
  controller: ExperienceController;
  switcher?: ReactNode;
  accountControl?: ReactNode;
  onSettings?: () => void;
  onOriginal?: () => void;
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
  const scopeHead = (
    <span className="scope-head">
      {layout === "bots" ? (
        <BotAvatar avatar={selected?.avatar} />
      ) : (
        <SetupGlyph layout={layout} />
      )}
      <span className="truncate">{selected?.label}</span>
    </span>
  );
  const sidebar = (
    <nav
      id="experience-navigation"
      aria-label={collection}
      className="experience-sidebar shrink-0 overflow-y-auto p-3"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setNavigation(false);
          toggle.current?.focus();
        }
      }}
    >
      <div
        className="sidebar-switcher drawer-switcher"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[role^="menuitem"]')
          )
            setNavigation(false);
        }}
      >
        {switcher}
      </div>
      <p className="sidebar-section">{setupContext[layout].section}</p>
      <div className="flex flex-col gap-1">
        {profile.scopes.map((item) => (
          <Button
            key={item.id}
            variant="secondary"
            size="small"
            className="experience-nav-row w-full justify-start"
            aria-current={item.id === scope.scopeId ? "page" : undefined}
            onClick={() => {
              controller.select({
                profileId: scope.profileId,
                scopeId: item.id,
              });
              setNavigation(false);
            }}
          >
            {layout === "bots" && (
              <span className="sidebar-avatar">
                <BotAvatar avatar={item.avatar} />
                <span
                  className="scope-work-dot"
                  data-working={profile.jobs.some(
                    (job) => job.scopeId === item.id && jobActive(job),
                  )}
                />
              </span>
            )}
            {layout !== "bots" && <SetupGlyph layout={layout} />}
            <span className="scope-row-copy min-w-0">
              <span className="block truncate">{item.label}</span>
              {layout === "sessions" && sessionRecency(item.createdAt) && (
                <span className="session-recency">{sessionRecency(item.createdAt)}</span>
              )}
            </span>
            {layout !== "bots" && (
              <span
                className="scope-work-dot"
                data-working={profile.jobs.some(
                  (job) => job.scopeId === item.id && jobActive(job),
                )}
              />
            )}
          </Button>
        ))}
      </div>
      <button
        type="button"
        className="quiet-action sidebar-new disabled:cursor-not-allowed"
        disabled={creating}
        onClick={() => {
          if (layout === "sessions") {
            setCreating(true);
            void controller
              .createScope("New session", profile.profile.plan.purpose)
              .then(() => setNavigation(false))
              .finally(() => setCreating(false));
          } else setAdding(!adding);
        }}
      >
        <span className="new-icon">
          <RiAddLine className="size-4" aria-hidden />
        </span>
        <span>{newLabel}</span>
      </button>
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
      <div className="sidebar-footer">
        <button className="quiet-action sidebar-original" onClick={() => {
          if (onOriginal) onOriginal();
          else controller.original();
          setNavigation(false);
        }}>
          <SetupGlyph layout="single" />
          Original chat
        </button>
      </div>
    </nav>
  );
  return (
    <>
      <header
        className={cx(
          "app-bar flex shrink-0 items-center",
          layout !== "single" && "has-side",
        )}
      >
        {layout !== "single" && (
          <div className="app-bar-side sidebar-header">{switcher}</div>
        )}
        <div className="app-bar-column reading-column">
          <div className="flex min-w-0 items-center gap-2">
            {layout !== "single" && (
              <button
                ref={toggle}
                className="quiet-action app-control drawer-toggle"
                aria-label={`Open ${collection}`}
                onClick={() => setNavigation(true)}
              >
                <RiMenuLine className="size-5" aria-hidden />
              </button>
            )}
            {layout === "single" || layout === "bots" ? switcher : scopeHead}
          </div>
          {accountControl}
        </div>
      </header>
      <main className="flex min-h-0 min-w-0 flex-1">
        {layout !== "single" && (
          <>
            <div className="desktop-sidebar">{sidebar}</div>
            <Dialog.Root open={navigation} onOpenChange={setNavigation}>
              <Dialog.Portal>
                <Dialog.Backdrop className="navigation-backdrop" />
                <Dialog.Popup className="navigation-drawer" finalFocus={toggle}>
                  <Dialog.Title className="sr-only">{collection}</Dialog.Title>
                  {navigation && sidebar}
                </Dialog.Popup>
              </Dialog.Portal>
            </Dialog.Root>
          </>
        )}
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col"
          aria-label={selected?.label ?? "Conversation"}
        >
          <ScopeConversation
            onSettings={onSettings}
            key={experienceKey(scope)}
            controller={controller}
            scope={scope}
          />
        </section>
      </main>
    </>
  );
}

function ScopeConversation({
  onSettings,
  controller,
  scope,
}: {
  controller: ExperienceController;
  scope: Scope;
  onSettings?: () => void;
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
  const bottom = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useTranscriptFollow(bottom, follow);
  const model = state?.chat.models.find(
    (item) => item.id === (entry.selection?.modelId ?? state.chat.modelId),
  );
  useEffect(() => {
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
        className="conversation-scroll min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const el = event.currentTarget;
              if (el) el.dataset.scrolled = String(el.scrollTop > 0);
          follow.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 96;
        }}
      >
        <div
          className="reading-column message-list flex min-h-full flex-col py-8"
          role="log"
          aria-live="off"
          aria-label="Conversation"
        >
          {!state ? (
            <p role="status" className="text-text-secondary">
              Loading conversation…
            </p>
          ) : !state.messages.length ? (
            <EmptyChat
              text={
                controller.profile?.profile.plan.layout === "bots"
                  ? state.scope.label === "Home"
                    ? "Ask Home anything. It can hand work to your other Bots."
                    : `Ask ${state.scope.label} anything. It keeps its own memory and conversation.`
                  : controller.profile?.profile.plan.layout === "channels"
                    ? "Gaia remembers facts you ask it to keep across every channel. Each channel keeps its own conversation."
                    : controller.profile?.profile.plan.layout === "sessions"
                      ? "A fresh conversation with its own model and effort settings."
                      : undefined
              }
              avatar={
                controller.profile?.profile.plan.layout === "bots" ? (
                  <BotAvatar avatar={state.scope.avatar} />
                ) : undefined
              }
            />
          ) : (
            state.messages.map((message) => {
              const jobs = state.jobs.filter(
                (job) =>
                  (state.messages.some((item) => item.id === job.answerId)
                    ? job.answerId === message.id
                    : job.messageId === message.id) && !job.parentId,
              );
              const runningJob = jobs.find(
                (job) => job.state.kind === "running",
              );
              return (
                <div
                  key={message.id}
                  data-role={message.role}
                  className="flex min-w-0 flex-col gap-3"
                >
                  <article
                    aria-label={
                      message.role === "user"
                        ? "You"
                        : controller.profile?.profile.plan.layout === "bots"
                          ? state.scope.label
                          : controller.profile?.profile.plan.assistantName
                    }
                    className={cx(
                      "message-text min-w-0 wrap-anywhere",
                      message.role === "user"
                        ? "owner-bubble self-end"
                        : "w-full",
                      message.role === "assistant" &&
                        message.id !==
                          state.messages.findLast((m) => m.role === "assistant")
                            ?.id &&
                        "earlier-answer",
                    )}
                  >
                    {message.role === "assistant" && (
                      <AssistantHead
                        name={
                          controller.profile?.profile.plan.layout === "bots"
                            ? state.scope.label
                            : controller.profile?.profile.plan.assistantName
                        }
                        avatar={
                          controller.profile?.profile.plan.layout === "bots" ? (
                            <BotAvatar avatar={state.scope.avatar} />
                          ) : undefined
                        }
                        active={jobs.some(jobActive)}
                        startedAt={
                          runningJob?.state.kind === "running"
                            ? runningJob.state.startedAt
                            : undefined
                        }
                      />
                    )}
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
                    {message.role === "assistant" &&
                      message.text &&
                      jobs.every((job) => job.state.kind === "completed") && (
                        <CopyButton label="Copy answer" text={message.text} />
                      )}
                  </article>
                  {jobs.map((job) => (
                    <JobRows
                      onSettings={onSettings}
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
                onSettings={onSettings}
                key={job.id}
                job={job}
                controller={controller}
                scope={scope}
              />
            ))}
          {Boolean(state?.messages.length) && (
            <div className="transcript-clearance" aria-hidden="true" />
          )}
          <div ref={bottom} />
        </div>
      </div>
      <div className="reading-column composer-column flex shrink-0 flex-col gap-3 pt-3">
        {(entry.error || controller.error) && (
          <p role="alert" className="text-text-error-primary">
            {entry.error || controller.error}
          </p>
        )}
        {entry.offline && <OfflineNotice />}
        {saved.kind === "error" && (
          <p role="alert">
            {saved.message}{" "}
            <button
              className="quiet-action quiet-link"
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
              className="quiet-action quiet-link"
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
        <SharedComposer
          label="Message assistant"
          placeholder={
            controller.profile?.profile.plan.layout === "bots"
              ? `Message ${state?.scope.label ?? "Home"}…`
              : controller.profile?.profile.plan.layout === "channels"
                ? `Message #${state?.scope.label ?? "Home"}…`
                : `Message ${controller.profile?.profile.plan.assistantName ?? "Gaia"}…`
          }
          draft={draft?.text ?? ""}
          images={draft?.images ?? []}
          ready={Boolean(draft)}
          supportsImages={Boolean(model?.capabilities?.images)}
          actionsDisabled={
            !state || entry.offline || entry.actions.has("compact")
          }
          modelDisabled={entry.offline}
          canSend={controller.canSend(scope)}
          chat={state?.chat}
          selection={entry.selection}
          onSelect={(selection) => controller.selectModel(scope, selection)}
          onChange={(text) =>
            entry.draft.update((value) => ({ ...value, text }))
          }
          onRemove={(id) =>
            entry.draft.update((value) => ({
              ...value,
              images: value.images.filter((image) => image.id !== id),
            }))
          }
          onImages={(files) => void controller.addImages(scope, files)}
          onCompose={(value) => controller.compose(scope, value)}
          onCompact={() => void controller.compact(scope)}
          onSend={send}
          onStop={
            state?.jobs.some(jobActive)
              ? () => {
                  for (const job of state.jobs.filter(jobActive))
                    void controller.stop(scope, job);
                }
              : undefined
          }
          stopDisabled={entry.offline}
        />
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
  onSettings,
  job,
  controller,
  scope,
}: {
  job: ExperienceJob;
  controller: ExperienceController;
  scope: Scope;
  onSettings?: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const state = job.state;
  const entry = controller.entry(scope);
  const profile = controller.profile;
  const avatar =
    profile?.profile.plan.layout === "bots"
      ? profile.scopes.find((item) => item.id === job.scopeId)?.avatar
      : undefined;
  const hasAnswer = entry.state?.messages.some(
    (message) => message.role === "assistant" && message.id === job.answerId,
  );
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
      {!hasAnswer && (
        <AssistantHead
          name={
            profile?.profile.plan.layout === "bots"
              ? profile.scopes.find((item) => item.id === job.scopeId)?.label
              : profile?.profile.plan.assistantName
          }
          avatar={assistantAvatar}
          active={jobActive(job)}
          startedAt={state.kind === "running" ? state.startedAt : undefined}
        />
      )}
      {activities.map((activity) => (
        <ProgressRow
          key={activity.id}
          active={false}
          startedAt={state.kind === "running" ? state.startedAt : undefined}
          avatar={null}
          description={activity.description}
        />
      ))}
      <ProgressRow
        error={state.kind === "failed" || state.kind === "uncertain"}
        active={false}
        startedAt={
          state.kind === "running"
            ? state.startedAt
            : state.kind === "queued"
              ? state.acceptedAt
              : undefined
        }
        avatar={null}
      >
        {state.kind !== "queued" &&
          state.kind !== "running" &&
          state.kind !== "stopping" && (
            <span>
              {state.kind === "failed" || state.kind === "uncertain"
                ? state.kind === "uncertain"
                  ? "This may already have happened. Try again only if you want it to run again."
                  : replyError(state.message)
                : state.kind === "interrupted"
                  ? "Interrupted. Not repeated automatically."
                  : "Stopped"}
            </span>
          )}
        {jobActive(job) ? (
          <button
            className="quiet-action quiet-link"
            disabled={entry.actions.has(job.id) || state.kind === "stopping"}
            aria-label={`Stop ${job.title}`}
            onClick={() => void controller.stop(scope, job)}
          >
            Stop
          </button>
        ) : (
          <button
            className="secondary-action retry-button"
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
      </ProgressRow>
      {state.kind === "failed" && (
        <FailurePath
          message={replyError(state.message)}
          onSettings={onSettings}
        />
      )}
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
  return (
    <span className="avatar-tile">
      <img src={`/bots/${local}.svg`} alt="" />
    </span>
  );
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
      <button className="quiet-action quiet-link" disabled={disabled} onClick={onConfirm}>
        {uncertain ? "Repeat action" : "Run it again"}
      </button>
      <button className="quiet-action quiet-link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
