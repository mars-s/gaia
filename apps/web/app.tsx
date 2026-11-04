import { useEffect, useRef, useState } from "react";
import {
  RiArrowUpLine,
  RiCloseLine,
  RiOpenaiFill,
  RiSettings3Line,
  RiStopFill,
} from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import { Input } from "@/components/base/input/input";
import { SocialButton } from "@/components/base/social-button/social-button";
import { Textarea } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";
import type { Snapshot } from "../../packages/protocol/index.ts";
import { uploadImage } from "../../packages/sdk/images.ts";
import { DraftImages, MessageImages } from "./image-previews";
import { readImageFiles, appendImages } from "./image-input";
import {
  createChatDraft,
  browserDraftPersistence,
  type DraftState,
} from "./chat-draft";
import { command, subscribe } from "../../packages/sdk/index.ts";
import {
  createProfileReader,
  interviewQuestionVisible,
  type OwnerState,
} from "../../packages/sdk/onboarding.ts";
import { ProfilePanel } from "./profile-panel";
import { ManagedSettings } from "./managed-settings";
import { ComposerActions, ComposerControls } from "./composer-controls";
import {
  createDraftStore,
  createReleaseObserver,
  loadedRelease,
} from "./renderer-release";
import { createAuthBrowserFlow, openAuthInBrowser } from "./browser-auth";

export function App() {
  const inFlight = useRef(false);
  const modelSelectionPending = useRef(false);
  const [profile, setProfile] = useState<OwnerState>();
  const [profileError, setProfileError] = useState(false);
  const [profileReader] = useState(() =>
    createProfileReader(
      (value) => {
        setProfile(value);
        setProfileError(false);
      },
      () => setProfileError(true),
    ),
  );
  const [state, setState] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [browserError, setBrowserError] = useState("");
  const [offline, setOffline] = useState(false);
  const [draftStore] = useState(() => createDraftStore(() => sessionStorage));
  const [draftState, setDraftState] = useState<DraftState>({ kind: "loading" });
  const [draftSession] = useState(() =>
    createChatDraft(
      browserDraftPersistence(),
      setDraftState,
      draftStore.read(),
    ),
  );
  const draft = draftState.kind === "ready" ? draftState.draft.text : "";
  const images = draftState.kind === "ready" ? draftState.draft.images : [];
  const [sendProgress, setSendProgress] = useState<
    | { kind: "idle" }
    | { kind: "uploading"; completed: number; total: number }
    | { kind: "sending" }
  >({ kind: "idle" });
  const uploadController = useRef<AbortController | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const [readingImages, setReadingImages] = useState(false);
  const imageReads = useRef(0);
  const composing = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [updateWaiting, setUpdateWaiting] = useState(false);
  const [observeRelease] = useState(() =>
    createReleaseObserver(
      () =>
        !inFlight.current &&
        !modelSelectionPending.current &&
        imageReads.current === 0 &&
        !composing.current &&
        draftSession.prepareReload(),
      () => window.location.reload(),
      loadedRelease(import.meta.url),
    ),
  );
  function setDraft(value: string) {
    draftSession.update((current) => ({ ...current, text: value }));
  }
  function receive(value: Snapshot) {
    setState(value);
    setUpdateWaiting(observeRelease(value.runtime?.release));
  }
  const [authReply, setAuthReply] = useState("");
  const [pending, setPending] = useState(false);
  const [modelPending, setModelPending] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const authFlow = useRef(createAuthBrowserFlow(openAuthInBrowser));
  const connection = state?.connection;
  const connected = connection?.kind === "connected";
  const running = state?.thread.run.kind === "running";
  const compacting = state?.chat?.compaction.kind === "running";
  const changingModel =
    modelPending ||
    (state?.thread.run.kind === "running" &&
      state.thread.run.operation === "model");
  const stoppable = running && !changingModel;
  const supportsImages = Boolean(
    state?.chat?.models.find((model) => model.id === state.chat?.modelId)
      ?.capabilities?.images,
  );
  const canSend =
    connected &&
    !offline &&
    !running &&
    !pending &&
    !modelPending &&
    !readingImages &&
    draftState.kind === "ready" &&
    (Boolean(draft.trim()) || images.length > 0) &&
    (!images.length || supportsImages);

  useEffect(() => {
    void draftSession.load();
  }, [draftSession]);
  useEffect(() => () => uploadController.current?.abort(), []);
  useEffect(() => {
    if (draftState.kind !== "ready") return;
    if (draftState.durability === "saved") draftStore.save("");
    if (
      state?.thread.messages.some(
        (message) =>
          message.role === "user" && message.id === draftState.draft.requestId,
      )
    )
      draftSession.completeSend(draftState.draft.requestId);
  }, [draftState, state?.thread.messages, draftSession, draftStore]);

  useEffect(() => {
    if (connected && !running) void profileReader.refresh();
    else profileReader.cancel();
    return profileReader.cancel;
  }, [connected, running, profileReader]);

  useEffect(
    () =>
      subscribe(
        (value) => {
          setState(value);
          setUpdateWaiting(observeRelease(value.runtime?.release));
          setOffline(false);
        },
        () => setOffline(true),
      ),
    [observeRelease],
  );

  useEffect(() => {
    if (!connection) return;
    if (connection.kind !== "connecting") setBrowserError("");
    void authFlow.current(connection).catch((cause: unknown) => {
      setBrowserError(
        cause instanceof Error
          ? cause.message
          : "Open your browser to continue signing in.",
      );
    });
  }, [connection]);

  useEffect(() => {
    if (connected && !accountOpen) composer.current?.focus();
  }, [connected, accountOpen, draftState.kind]);

  useEffect(() => {
    setUpdateWaiting(observeRelease(state?.runtime?.release));
  }, [
    draftState,
    pending,
    modelPending,
    readingImages,
    observeRelease,
    state?.runtime?.release,
  ]);

  const lastMessage = state?.thread.messages.at(-1);
  const proposalId =
    profile?.kind === "proposed" ? profile.proposalId : undefined;
  useEffect(() => {
    if (followReply.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [lastMessage?.text, lastMessage?.id, profile?.kind, proposalId]);

  async function act(path: string, input: unknown = {}) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      receive(await command(path, input));
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Gaia could not complete that request. Try again.",
      );
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  async function profileAction(action: string) {
    profileReader.cancel();
    const input =
      action === "confirm" && profile?.kind === "proposed"
        ? { proposalId: profile.proposalId }
        : {};
    if (await act(`profile/${action}`, input)) {
      await profileReader.refresh();
      if (
        action === "start" ||
        action === "edit" ||
        action === "skip" ||
        action === "confirm"
      )
        setAccountOpen(false);
    } else await profileReader.refresh();
  }
  const profilePanel = (account = false) => (
    <ProfilePanel
      state={profile}
      failed={profileError}
      account={account}
      disabled={pending || running || offline || profileError}
      onAction={(action) => void profileAction(action)}
      onRetry={() => void profileReader.refresh()}
      showQuestion={
        profile?.kind === "interview" &&
        interviewQuestionVisible(profile, state?.thread.messages ?? [])
      }
      skipDisabled={pending || offline || profileError}
    />
  );

  async function send() {
    if (!canSend || inFlight.current) return;
    const current = draftSession.read();
    if (current.kind !== "ready") return;
    const sentDraft = current.draft;
    inFlight.current = true;
    setPending(true);
    setError("");
    const controller = new AbortController();
    uploadController.current = controller;
    followReply.current = true;
    try {
      for (let n = 0; n < sentDraft.images.length; n++) {
        setSendProgress({
          kind: "uploading",
          completed: n,
          total: sentDraft.images.length,
        });
        await uploadImage(sentDraft.images[n], controller.signal);
      }
      controller.signal.throwIfAborted();
      setSendProgress({ kind: "sending" });
      receive(
        await command(
          "messages",
          {
            text: sentDraft.text.trim(),
            requestId: sentDraft.requestId,
            ...(sentDraft.images.length
              ? { attachments: sentDraft.images.map((image) => image.id) }
              : {}),
          },
          controller.signal,
        ),
      );
      draftSession.completeSend(sentDraft.requestId);
    } catch (cause) {
      setError(
        controller.signal.aborted
          ? "Upload cancelled. Your draft is here."
          : cause instanceof Error
            ? cause.message
            : "Message could not be sent. Your draft is here.",
      );
    } finally {
      inFlight.current = false;
      uploadController.current = undefined;
      setSendProgress({ kind: "idle" });
      setPending(false);
    }
  }

  async function addImages(files: File[]) {
    if (!files.length) return;
    if (draftSession.read().kind !== "ready") {
      setError("Wait for your saved draft to load before attaching images.");
      return;
    }
    if (!supportsImages) {
      setError(
        "This model does not accept images. Choose an image-capable model first.",
      );
      return;
    }
    imageReads.current++;
    setReadingImages(true);
    setError("");
    try {
      const added = await readImageFiles(files);
      draftSession.update((current) => ({
        ...current,
        images: appendImages(current.images, added),
      }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Images could not be read. Try choosing them again.",
      );
    } finally {
      imageReads.current--;
      setReadingImages(imageReads.current > 0);
    }
  }

  async function openBrowser() {
    if (connection?.kind !== "connecting" || !connection.url) return;
    try {
      await openAuthInBrowser(connection.url);
      setBrowserError("");
    } catch (cause) {
      setBrowserError(
        cause instanceof Error
          ? cause.message
          : "Your browser could not open. Try again.",
      );
    }
  }

  const chatError =
    error ||
    (state?.thread.run.kind === "error" ? state.thread.run.message : "");
  const canRetry =
    state?.thread.run.kind === "error" || state?.thread.run.kind === "stopped";

  return (
    <div className="app-shell flex h-dvh flex-col bg-background-full text-body-regular text-text-primary">
      <header className="app-bar flex shrink-0 items-center justify-between gap-4 px-4">
        <span className="select-none text-body-medium">Gaia</span>
        {connected && (
          <IconButton
            className="app-control border-transparent bg-transparent shadow-none"
            icon={accountOpen ? RiCloseLine : RiSettings3Line}
            aria-label={
              accountOpen ? "Close account settings" : "Account settings"
            }
            aria-expanded={accountOpen}
            aria-controls="account-settings"
            onClick={() => setAccountOpen(!accountOpen)}
          />
        )}
      </header>

      {accountOpen && connected ? (
        <main
          id="account-settings"
          className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6"
        >
          <section
            className="flex w-full max-w-xs flex-col items-start gap-6"
            aria-labelledby="account-title"
          >
            <div className="flex flex-col gap-2">
              <h1 id="account-title" className="text-title-3-semibold">
                Account
              </h1>
              <p className="text-text-secondary">ChatGPT is connected.</p>
            </div>
            <Button
              variant="secondary"
              disabled={pending || running || offline}
              onClick={() =>
                void act("auth/connect").then((ok) => {
                  if (ok) setAccountOpen(false);
                })
              }
            >
              Reconnect ChatGPT
            </Button>
            {profilePanel(true)}
            <ManagedSettings runtime={state?.runtime} />
            {error && (
              <p role="alert" className="text-text-error-primary">
                {error}
              </p>
            )}
          </section>
        </main>
      ) : !state || !connected ? (
        <main className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 pb-12">
          <section
            className="flex w-full max-w-xs flex-col gap-6"
            aria-labelledby="welcome-title"
          >
            {!state ? (
              <p
                id="welcome-title"
                role="status"
                className="text-text-secondary"
              >
                {offline
                  ? "Gaia is unavailable. Reconnecting…"
                  : "Connecting to Gaia…"}
              </p>
            ) : connection?.kind === "connecting" ? (
              <>
                <div className="flex flex-col gap-2">
                  <h1 id="welcome-title" className="text-title-3-semibold">
                    Finish in your browser
                  </h1>
                  <p className="text-text-secondary">
                    Sign in to ChatGPT, then come back here.
                  </p>
                </div>
                <Button
                  className="self-start"
                  variant="secondary"
                  disabled={!connection.url}
                  onClick={() => void openBrowser()}
                >
                  Open browser
                </Button>
                {browserError && (
                  <p role="alert" className="text-text-error-primary">
                    {browserError}
                  </p>
                )}
                {connection.prompt && (
                  <details className="auth-help text-text-secondary">
                    <summary className="cursor-pointer rounded-md text-caption-1-medium outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                      Having trouble?
                    </summary>
                    <form
                      className="mt-4 flex flex-col gap-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!authReply.trim() || pending || offline) return;
                        void act("auth/reply", {
                          value: authReply.trim(),
                        }).then((ok) => {
                          if (ok) setAuthReply("");
                        });
                      }}
                    >
                      <Input
                        label={connection.prompt}
                        autoComplete="off"
                        value={authReply}
                        onChange={setAuthReply}
                      />
                      <Button
                        variant="secondary"
                        type="submit"
                        disabled={!authReply.trim() || pending || offline}
                      >
                        Continue
                      </Button>
                    </form>
                  </details>
                )}
              </>
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <h1 id="welcome-title" className="text-title-3-semibold">
                    Welcome to Gaia
                  </h1>
                  <p className="text-text-secondary">
                    {connection?.kind === "disconnected"
                      ? connection.message
                      : "Connect your ChatGPT account to get started."}
                  </p>
                </div>
                <SocialButton
                  brand="custom"
                  config={{
                    label: "ChatGPT",
                    icon: <RiOpenaiFill className="size-full" aria-hidden />,
                  }}
                  appearance="white"
                  fullWidth
                  disabled={pending || offline}
                  onClick={() => void act("auth/connect")}
                >
                  {pending ? "Connecting…" : "Continue with ChatGPT"}
                </SocialButton>
              </>
            )}
            {offline && state && (
              <p role="alert" className="text-text-error-primary">
                Connection lost. Reconnecting…
              </p>
            )}
            {error && (
              <p role="alert" className="text-text-error-primary">
                {error}
              </p>
            )}
          </section>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 flex-col">
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            ref={transcript}
            onScroll={() => {
              const el = transcript.current;
              if (el)
                followReply.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 96;
            }}
          >
            <section
              className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 sm:px-8"
              role="log"
              aria-label="Conversation"
              aria-busy={running}
            >
              {state.thread.messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center py-12">
                  <h1 className="text-title-3-semibold">
                    What’s on your mind?
                  </h1>
                </div>
              ) : (
                <div className="flex flex-col gap-8 py-8">
                  {state.thread.messages.map((message) => (
                    <article
                      key={message.id}
                      aria-label={message.role === "user" ? "You" : "Gaia"}
                      className={cx(
                        "message-text whitespace-pre-wrap wrap-anywhere",
                        message.role === "user"
                          ? "max-w-[88%] self-end rounded-3xl bg-background-secondary-default px-5 py-3"
                          : "w-full max-w-[72ch] self-start",
                      )}
                    >
                      {message.attachments?.length ? (
                        <MessageImages images={message.attachments} />
                      ) : null}
                      {message.text ||
                        (message.role === "user" &&
                        message.attachments?.length ? null : running &&
                          message.id === lastMessage?.id ? (
                          <span className="text-text-secondary" role="status">
                            Thinking…
                          </span>
                        ) : (
                          <span className="text-text-secondary">
                            {state.thread.run.kind === "stopped"
                              ? "Reply stopped."
                              : "No reply received."}
                          </span>
                        ))}
                    </article>
                  ))}
                </div>
              )}
              {(!profile ||
                profileError ||
                profile.kind === "interview" ||
                profile.kind === "proposed" ||
                (profile.kind === "new" &&
                  state.thread.messages.length === 0)) && (
                <div className="py-4">{profilePanel()}</div>
              )}
              <div ref={bottom} />
            </section>
          </div>
          <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-3 px-4 pt-3 pb-5 sm:px-8 sm:pb-8">
            <span className="sr-only" role="status">
              {running
                ? compacting
                  ? "Compacting context"
                  : state.thread.run.kind === "running" &&
                      state.thread.run.operation === "upload"
                    ? "Preparing images"
                    : changingModel
                      ? "Updating model and effort"
                      : "Gaia is replying"
                : state.thread.run.kind === "stopped"
                  ? "Reply stopped"
                  : ""}
            </span>
            {state.runtime?.mode === "safe" && (
              <p
                role="status"
                className="text-caption-1-regular text-text-secondary"
              >
                Safe mode. Changes are disabled. You can still chat.
              </p>
            )}
            {updateWaiting && (
              <p
                role="status"
                className="text-caption-1-regular text-text-secondary"
              >
                An update is ready. Your draft must finish saving before Gaia
                reloads.
              </p>
            )}
            {offline && (
              <p role="alert" className="text-text-error-primary">
                Connection lost. Reconnecting… Your draft is here.
              </p>
            )}
            {(chatError || canRetry) && (
              <div
                className="flex flex-wrap items-center gap-2"
                role={chatError ? "alert" : undefined}
              >
                {chatError && (
                  <p className="min-w-0 flex-1 wrap-anywhere text-text-error-primary">
                    {chatError}
                  </p>
                )}
                {canRetry && (
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={pending || offline || running}
                    onClick={() => void act("retry")}
                  >
                    Try again
                  </Button>
                )}
              </div>
            )}
            {draftState.kind === "error" ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 text-text-secondary"
              >
                <p>{draftState.message}</p>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => void draftSession.load()}
                >
                  Retry draft
                </Button>
              </div>
            ) : draftState.kind === "ready" &&
              draftState.durability === "memory" ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 text-text-secondary"
              >
                <p>
                  Your draft is kept in this window. Storage is unavailable.
                </p>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => draftSession.retrySave()}
                >
                  Retry saving
                </Button>
              </div>
            ) : null}
            {images.length > 0 && !supportsImages && (
              <p
                role="alert"
                className="text-caption-1-regular text-text-secondary"
              >
                This model cannot use images. Choose another model or remove the
                images to send.
              </p>
            )}
            <span className="sr-only" role="status">
              {draftState.kind === "loading"
                ? "Loading saved draft"
                : readingImages
                  ? "Reading images"
                  : sendProgress.kind === "uploading"
                    ? `Uploading image ${sendProgress.completed + 1} of ${sendProgress.total}`
                    : sendProgress.kind === "sending"
                      ? "Sending message"
                      : ""}
            </span>
            {(readingImages || sendProgress.kind !== "idle") && (
              <p
                role="status"
                className="px-2 text-caption-1-regular text-text-secondary"
              >
                {sendProgress.kind === "uploading"
                  ? `Uploading image ${sendProgress.completed + 1} of ${sendProgress.total}…`
                  : sendProgress.kind === "sending"
                    ? "Sending…"
                    : "Preparing images…"}
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
                    event.relatedTarget instanceof Node
                      ? event.relatedTarget
                      : null,
                  )
                )
                  setDragging(false);
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.files.length) return;
                event.preventDefault();
                setDragging(false);
                void addImages(Array.from(event.dataTransfer.files));
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (files.length) {
                  event.preventDefault();
                  void addImages(files);
                  const text = event.clipboardData.getData("text/plain");
                  const start =
                    composer.current?.selectionStart ?? draft.length;
                  const end = composer.current?.selectionEnd ?? start;
                  if (text)
                    draftSession.update((current) => ({
                      ...current,
                      text: (
                        current.text.slice(0, start) +
                        text +
                        current.text.slice(end)
                      ).slice(0, 32000),
                    }));
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              {images.length > 0 && (
                <DraftImages
                  images={images}
                  onRemove={(id) =>
                    draftSession.update((current) => ({
                      ...current,
                      images: current.images.filter((image) => image.id !== id),
                    }))
                  }
                />
              )}
              {dragging && (
                <span className="col-span-full px-3 pt-1 text-caption-1-medium text-text-secondary">
                  Drop images to attach
                </span>
              )}
              <input
                ref={fileInput}
                className="hidden"
                type="file"
                tabIndex={-1}
                accept="image/png,image/jpeg,image/webp"
                multiple
                aria-label="Choose images"
                disabled={!supportsImages || draftState.kind !== "ready"}
                onChange={(event) => {
                  void addImages(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
                <ComposerActions
                  disabled={pending || offline || running}
                  onAttach={
                    supportsImages && draftState.kind === "ready"
                      ? () => fileInput.current?.click()
                      : undefined
                  }
                  onCompact={() => void act("compact")}
                  onHistory={
                    state.runtime ? () => setAccountOpen(true) : undefined
                  }
                />
                <Textarea
                  ref={composer}
                  className="col-start-2 row-start-1 w-full min-w-0"
                  fieldClassName="rounded-2xl bg-transparent ring-0 hover:ring-0 focus-within:ring-0"
                  inputClassName="placeholder:text-text-secondary focus:placeholder:text-text-secondary"
                  aria-label="Message Gaia"
                  rows={1}
                  autoResize
                  maxRows={8}
                  maxLength={32000}
                  value={draft}
                  isDisabled={draftState.kind !== "ready"}
                  onChange={setDraft}
                  onCompositionStart={() => {
                    composing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composing.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing &&
                      event.keyCode !== 229
                    ) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Ask me anything…"
                />
                {state.chat ? (
                  <ComposerControls
                    chat={state.chat}
                    disabled={
                      offline || ((pending || running) && !changingModel)
                    }
                    onPendingChange={(value) => {
                      modelSelectionPending.current = value;
                      setModelPending(value);
                    }}
                    onModel={(modelId, thinkingLevel) =>
                      act("model", {
                        modelId,
                        ...(thinkingLevel ? { thinkingLevel } : {}),
                      })
                    }
                  />
                ) : null}
                <IconButton
                  className="col-start-3 row-start-1 shrink-0 self-end rounded-full border-transparent bg-accent-500 text-text-white shadow-none hover:border-transparent hover:bg-accent-600 active:border-transparent active:bg-accent-700 disabled:border-transparent disabled:bg-accent-500 disabled:text-text-white disabled:opacity-40 sm:col-start-4"
                  icon={
                    stoppable || sendProgress.kind === "uploading"
                      ? RiStopFill
                      : RiArrowUpLine
                  }
                  aria-label={
                    sendProgress.kind === "uploading"
                      ? "Cancel image upload"
                      : stoppable
                        ? compacting
                          ? "Stop compaction"
                          : "Stop reply"
                        : "Send message"
                  }
                  type={
                    stoppable || sendProgress.kind === "uploading"
                      ? "button"
                      : "submit"
                  }
                  disabled={
                    sendProgress.kind === "uploading"
                      ? false
                      : stoppable
                        ? pending || offline
                        : !canSend
                  }
                  onClick={
                    sendProgress.kind === "uploading"
                      ? () => uploadController.current?.abort()
                      : stoppable
                        ? () => void act("stop")
                        : undefined
                  }
                />
              </div>
            </form>
            {state.chat && state.chat.compaction.kind !== "idle" && (
              <p
                role={
                  state.chat.compaction.kind === "error" ? "alert" : "status"
                }
                className="px-2 text-caption-1-regular text-text-secondary"
              >
                {state.chat.compaction.message}
              </p>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
