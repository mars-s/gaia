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
import { command, subscribe } from "../../packages/sdk/index.ts";
import { ManagedSettings } from "./managed-settings";
import { ComposerActions, ComposerControls } from "./composer-controls";
import {
  createDraftStore,
  createReleaseObserver,
  loadedRelease,
} from "./renderer-release";
import { createAuthBrowserFlow, openAuthInBrowser } from "./browser-auth";

export function App() {
  const [state, setState] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [browserError, setBrowserError] = useState("");
  const [offline, setOffline] = useState(false);
  const [draftStore] = useState(() => createDraftStore(() => sessionStorage));
  const [draft, updateDraft] = useState(() => draftStore.read());
  const [updateWaiting, setUpdateWaiting] = useState(false);
  const [observeRelease] = useState(() =>
    createReleaseObserver(
      draftStore.prepareReload,
      () => window.location.reload(),
      loadedRelease(import.meta.url),
    ),
  );
  function setDraft(value: string) {
    draftStore.save(value);
    updateDraft(value);
  }
  function receive(value: Snapshot) {
    setState(value);
    setUpdateWaiting(observeRelease(value.runtime?.release));
  }
  const [authReply, setAuthReply] = useState("");
  const [pending, setPending] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const inFlight = useRef(false);
  const composer = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followReply = useRef(true);
  const authFlow = useRef(createAuthBrowserFlow(openAuthInBrowser));
  const connection = state?.connection;
  const connected = connection?.kind === "connected";
  const running = state?.thread.run.kind === "running";
  const compacting = state?.chat?.compaction.kind === "running";
  const canSend =
    connected && !offline && !running && !pending && Boolean(draft.trim());

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
  }, [connected, accountOpen]);

  useEffect(() => {
    setUpdateWaiting(observeRelease(state?.runtime?.release));
  }, [draft, observeRelease, state?.runtime?.release]);

  const lastMessage = state?.thread.messages.at(-1);
  useEffect(() => {
    if (followReply.current) bottom.current?.scrollIntoView({ block: "end" });
  }, [lastMessage?.text, lastMessage?.id]);

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

  async function send() {
    if (!canSend || inFlight.current) return;
    const sentDraft = draft;
    followReply.current = true;
    if (
      await act("messages", {
        text: sentDraft.trim(),
        requestId: crypto.randomUUID(),
      })
    ) {
      updateDraft(draftStore.completeSend(sentDraft));
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
                      {message.text ||
                        (running && message.id === lastMessage?.id ? (
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
              <div ref={bottom} />
            </section>
          </div>
          <div className="mx-auto flex w-full max-w-3xl shrink-0 flex-col gap-3 px-4 pt-3 pb-5 sm:px-8 sm:pb-8">
            <span className="sr-only" role="status">
              {running
                ? compacting
                  ? "Compacting context"
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
                An update is ready. Send or clear your draft to load it, or
                enable session storage.
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
            <form
              className="composer grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2 rounded-[28px] border border-transparent bg-background-tertiary-default p-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
              aria-label="Message Gaia"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <ComposerActions
                disabled={pending || offline || running}
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
                onChange={setDraft}
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
                  disabled={pending || offline || running}
                  onModel={(modelId) => void act("model", { modelId })}
                />
              ) : null}
              <IconButton
                className="col-start-3 row-start-1 shrink-0 self-end rounded-full border-transparent bg-accent-500 text-text-white shadow-none hover:border-transparent hover:bg-accent-600 active:border-transparent active:bg-accent-700 disabled:border-transparent disabled:bg-accent-500 disabled:text-text-white disabled:opacity-40 sm:col-start-4"
                icon={running ? RiStopFill : RiArrowUpLine}
                aria-label={
                  running
                    ? compacting
                      ? "Stop compaction"
                      : "Stop reply"
                    : "Send message"
                }
                type={running ? "button" : "submit"}
                disabled={running ? pending || offline : !canSend}
                onClick={running ? () => void act("stop") : undefined}
              />
            </form>
            <div className="flex justify-end px-2">
              <Button
                className="bg-transparent text-text-secondary shadow-none hover:bg-background-secondary-hover"
                type="button"
                variant="ghost"
                size="xs"
                disabled={pending || offline || running}
                title="Summarise older context and keep the chat history"
                onClick={() => void act("compact")}
              >
                {compacting ? "Compacting…" : "Compact"}
              </Button>
            </div>
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
