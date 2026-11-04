import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Textarea } from "@/components/base/textarea/textarea";
import { Input } from "@/components/base/input/input";
import type { Snapshot } from "../../packages/protocol/index.ts";
import { command, subscribe } from "../../packages/sdk/index.ts";
import "./styles/globals.css";
import "./style.css";
function App() {
  const [state, setState] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [draft, setDraft] = useState("");
  const [authReply, setAuthReply] = useState("");
  const [pending, setPending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      subscribe(
        (value) => {
          setState(value);
          setOffline(false);
        },
        () => setOffline(true),
      ),
    [],
  );
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [state?.thread.messages.at(-1)?.text]);
  const running = state?.thread.run.kind === "running";
  async function act(path: string, input: unknown = {}) {
    setPending(true);
    try {
      setState(await command(path, input));
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed. Try again.");
      return false;
    } finally {
      setPending(false);
    }
  }
  async function send() {
    const text = draft.trim();
    if (!text || running || pending) return;
    const sent = await act("messages", {
      text,
      requestId: crypto.randomUUID(),
    });
    if (sent) setDraft("");
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-5 p-4 sm:p-6 text-text-primary text-body-regular">
      <header className="flex items-baseline gap-4 border-b border-separator-border pb-4">
        <h1 className="text-title-2-medium">Gaia</h1>
        <span className="text-text-tertiary">Local chat</span>
      </header>
      <section
        className="flex flex-wrap items-center gap-3 text-text-secondary"
        aria-live="polite"
      >
        {!state ? (
          "Connecting to Gaia…"
        ) : state.connection.kind === "connected" ? (
          <>
            <span>ChatGPT connected · Sol 6.1</span>
            <Button
              variant="ghost"
              size="small"
              disabled={pending || running}
              onClick={() => void act("auth/connect")}
            >
              Reconnect ChatGPT
            </Button>
          </>
        ) : state.connection.kind === "disconnected" ? (
          <>
            <span>{state.connection.message}</span>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => void act("auth/connect")}
            >
              Connect ChatGPT
            </Button>
          </>
        ) : (
          <>
            <span>Finish signing in to ChatGPT.</span>
            {state.connection.url && (
              <ButtonLink
                variant="secondary"
                href={state.connection.url}
                target="_blank"
                rel="noreferrer"
              >
                Open sign-in
              </ButtonLink>
            )}
            {state.connection.prompt && (
              <form
                className="flex w-full flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("auth/reply", { value: authReply });
                  setAuthReply("");
                }}
              >
                <Input
                  label={state.connection.prompt}
                  autoComplete="off"
                  value={authReply}
                  onChange={setAuthReply}
                />
                <Button type="submit" variant="secondary">
                  Continue
                </Button>
              </form>
            )}
          </>
        )}
      </section>
      <section className="flex-1" aria-label="Conversation" aria-busy={running}>
        {state?.thread.messages.length === 0 && (
          <div className="max-w-md py-16 text-text-secondary">
            <h2 className="mb-3 text-title-1-medium text-text-primary">
              What’s on your mind?
            </h2>
            <p>
              Ask a question or work through an idea. This conversation is saved
              on this Mac.
            </p>
          </div>
        )}
        {state?.thread.messages.map((m) => (
          <article className="my-6" key={m.id}>
            <h2 className="mb-2 text-caption-1-semibold text-text-tertiary">
              {m.role === "user" ? "You" : "Gaia"}
            </h2>
            <div className="message-text whitespace-pre-wrap wrap-anywhere">
              {m.text ||
                (running && m === state.thread.messages.at(-1)
                  ? "Thinking…"
                  : "No reply text.")}
            </div>
          </article>
        ))}
        <div ref={bottom} />
      </section>
      <div role="status" className="text-text-secondary">
        {running
          ? "Sol is replying…"
          : state?.thread.run.kind === "stopped"
            ? "Reply stopped. You can retry or send another message."
            : ""}
      </div>
      {state?.thread.run.kind === "error" && (
        <p role="alert" className="text-text-error-primary">
          {state.thread.run.message}
        </p>
      )}
      {offline && (
        <p role="alert" className="text-text-error-primary">
          Connection lost. Reconnecting automatically. Your saved messages will
          reload.
        </p>
      )}
      {error && (
        <p role="alert" className="text-text-error-primary">
          {error}
        </p>
      )}
      <form
        className="sticky bottom-0 flex flex-col gap-3 bg-background-full py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Textarea
          label="Message Gaia"
          rows={3}
          maxLength={32000}
          value={draft}
          onChange={setDraft}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask anything…"
        />
        <div className="flex flex-wrap items-center justify-end gap-3">
          <small className="me-auto text-caption-1-regular text-text-tertiary">
            Enter to send · Shift+Enter for a new line
          </small>
          {running ? (
            <Button
              variant="secondary"
              type="button"
              disabled={pending}
              onClick={() => void act("stop")}
            >
              Stop
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                type="button"
                disabled={
                  pending ||
                  offline ||
                  !state?.thread.messages.some((m) => m.role === "user") ||
                  state.connection.kind !== "connected"
                }
                onClick={() => void act("retry")}
              >
                Retry last
              </Button>
              <Button
                variant="secondary"
                type="submit"
                disabled={
                  pending ||
                  offline ||
                  !draft.trim() ||
                  state?.connection.kind !== "connected"
                }
              >
                Send
              </Button>
            </>
          )}
        </div>
      </form>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing app root");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
