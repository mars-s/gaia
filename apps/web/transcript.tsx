import { ColourCode, languageLabel } from "./code-colour";
import { AssistantHead } from "./assistant-head";
import { CopyButton, codeText } from "./copy-button";
import { ReplyNotice, replyError } from "./progress-row";
import { useEffect, useRef, useState, useMemo, type ReactNode, Children, isValidElement } from "react";
import type { ThreadMessageLike } from "@assistant-ui/core";
import {
  AssistantRuntimeProvider,
  MessagePrimitiveParts,
  ThreadPrimitiveMessages,
  useExternalStoreRuntime,
} from "@assistant-ui/core/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Thread } from "../../packages/protocol/index.ts";
import { MessageImages } from "./image-previews";
import { cx } from "./utils/cx";

export function transcriptMessages(thread: Thread): ThreadMessageLike[] {
  return thread.messages.map((message, index) => ({
    id: message.id,
    role: message.role,
    createdAt: new Date(message.createdAt),
    content: [{ type: "text", text: message.text }],
    ...(message.role === "assistant"
      ? {
          status:
            index !== thread.messages.length - 1
              ? { type: "complete", reason: "stop" }
              : thread.run.kind === "running"
                ? { type: "running" }
                : thread.run.kind === "stopped"
                  ? { type: "incomplete", reason: "cancelled" }
                  : thread.run.kind === "error"
                    ? { type: "incomplete", reason: "error" }
                    : { type: "complete", reason: "stop" },
        }
      : {}),
  }));
}

export function markdownUrl(url: string) {
  if (/^(https?:|mailto:)/i.test(url)) return url;
  if (
    !/^[\s\\/]*\//.test(url) &&
    !/[:\\]/.test(url) &&
    !Array.from(url).some((char) => char.charCodeAt(0) <= 32)
  )
    return url;
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\"))
    return url;
  return "";
}

export function MessageMarkdown({ text }: { text: string }) {
  return (
    <div className="message-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={markdownUrl}
        components={{
          a: ({ href, children }) =>
            href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          img: ({ alt }) => (
            <span className="text-text-secondary">
              {alt || "Image omitted"}
            </span>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

export function CodeBlock({ children }: { children: ReactNode }) {
  const code = Children.toArray(children).find(isValidElement);
  const language = isValidElement<{ className?: string }>(code)
    ? /(?:^|\s)language-([\w+-]+)/.exec(code.props.className ?? "")?.[1]
    : undefined;
  const pre = useRef<HTMLPreElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = pre.current;
    if (!element) return;
    const measure = () =>
      setOverflow(window.innerWidth >= 640 && element.scrollWidth - element.clientWidth - element.scrollLeft > 1);
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [children]);
  return (
    <div className="code-block" data-overflow={overflow || undefined}>
      <div className="code-header">
        <span>{languageLabel(language)}</span>
        <CopyButton label="Copy code" text={codeText(children)} />
      </div>
      <div className="code-scroll-area">
        <pre ref={pre}><code className={language ? `language-${language}` : undefined}><ColourCode text={codeText(children)} language={language} /></code></pre>
      </div>
    </div>
  );
}

async function readOnlyTranscript(): Promise<void> {
  throw new Error("Send messages using Gaia’s composer.");
}

export function Transcript({
  thread,
  afterMessage,
  onRetry,
  retryDisabled,
  onSettings,
}: {
  thread: Thread;
  hasSetupCard?: (id: string) => boolean;
  onSettings?: () => void;
  onRetry?: () => void;
  retryDisabled?: boolean;
  afterMessage?: (id: string) => ReactNode;
}) {
  const messages = useMemo(() => transcriptMessages(thread), [thread]);
  const byId = new Map(thread.messages.map((message) => [message.id, message]));
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isRunning: thread.run.kind === "running",
    isDisabled: true,
    onNew: readOnlyTranscript,
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="message-list flex flex-col py-8">
        <ThreadPrimitiveMessages>
          {({ message }) => {
            const source = byId.get(message.id);
            const user = message.role === "user";
            return (
              <article
                aria-label={user ? "You" : "Gaia"}
                data-role={user ? "user" : "assistant"}
                className={cx(
                  "message-text min-w-0 wrap-anywhere",
                  user ? "owner-bubble self-end" : "w-full self-start",
                  !user &&
                    message.id !==
                      thread.messages.findLast((m) => m.role === "assistant")
                        ?.id &&
                    "earlier-answer",
                )}
              >
                {!user && (
                  <AssistantHead
                    key={
                      thread.run.kind === "running" ? thread.run.id : message.id
                    }
                    active={message.status?.type === "running"}
                  />
                )}
                {source?.attachments?.length ? (
                  <MessageImages images={source.attachments} />
                ) : null}
                {source?.text ? (
                  <MessagePrimitiveParts
                    components={{ Text: user ? PlainText : MessageMarkdown }}
                  />
                ) : !user || !source?.attachments?.length ? (
                  <div
                    className="text-text-secondary"
                    role={
                      message.status?.type === "running" ? "status" : undefined
                    }
                  >
                    {message.status?.type === "running"
                      ? null
                      : message.status?.type === "incomplete" &&
                          message.status.reason === "cancelled"
                        ? "Reply stopped."
                        : thread.run.kind === "error"
                          ? null
                          : "No reply received."}
                  </div>
                ) : null}
                {!user &&
                  source?.text &&
                  message.status?.type === "complete" &&
                  (
                    <div className="reply-actions"><CopyButton label="Copy answer" text={source.text} /></div>
                  )}
                {!user &&
                  message.id === thread.messages.at(-1)?.id &&
                  (thread.run.kind === "error" ? (
                    <ReplyNotice
                      onSettings={onSettings}
                      message={replyError(thread.run.message)}
                      onRetry={onRetry}
                      disabled={retryDisabled}
                    />
                  ) : thread.run.kind === "stopped" && onRetry ? (
                    <ReplyNotice
                      onSettings={onSettings}
                      message="Stopped."
                      onRetry={onRetry}
                      disabled={retryDisabled}
                    />
                  ) : null)}
                {afterMessage?.(message.id)}
              </article>
            );
          }}
        </ThreadPrimitiveMessages>
        {thread.messages.at(-1)?.role !== "assistant" &&
          (thread.run.kind === "error" || thread.run.kind === "stopped") && (
            <article
              aria-label="Gaia"
              data-role="assistant"
              className="message-text w-full"
            >
              <AssistantHead />
              {thread.run.kind === "error" ? (
                <ReplyNotice
                  onSettings={onSettings}
                  message={replyError(thread.run.message)}
                  onRetry={onRetry}
                  disabled={retryDisabled}
                />
              ) : thread.run.kind === "stopped" && onRetry ? (
                <ReplyNotice
                  onSettings={onSettings}
                  message="Stopped."
                  onRetry={onRetry}
                  disabled={retryDisabled}
                />
              ) : null}
            </article>
          )}
      </div>
    </AssistantRuntimeProvider>
  );
}

function PlainText({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap">{text}</span>;
}
