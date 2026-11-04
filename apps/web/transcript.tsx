import { useMemo } from "react";
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

async function readOnlyTranscript(): Promise<void> {
  throw new Error("Send messages using Gaia's composer.");
}

export function Transcript({ thread }: { thread: Thread }) {
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
      <div className="flex flex-col gap-8 py-8">
        <ThreadPrimitiveMessages>
          {({ message }) => {
            const source = byId.get(message.id);
            const user = message.role === "user";
            return (
              <article
                aria-label={user ? "You" : "Gaia"}
                className={cx(
                  "message-text min-w-0 wrap-anywhere",
                  user
                    ? "max-w-[88%] self-end rounded-3xl bg-background-secondary-default px-5 py-3"
                    : "w-full max-w-[72ch] self-start",
                )}
              >
                {source?.attachments?.length ? (
                  <MessageImages images={source.attachments} />
                ) : null}
                {source?.text ? (
                  <MessagePrimitiveParts
                    components={{ Text: user ? PlainText : MessageMarkdown }}
                  />
                ) : !user || !source?.attachments?.length ? (
                  <span
                    className="text-text-secondary"
                    role={
                      message.status?.type === "running" ? "status" : undefined
                    }
                  >
                    {message.status?.type === "running"
                      ? "Thinking…"
                      : message.status?.type === "incomplete" &&
                          message.status.reason === "cancelled"
                        ? "Reply stopped."
                        : "No reply received."}
                  </span>
                ) : null}
              </article>
            );
          }}
        </ThreadPrimitiveMessages>
      </div>
    </AssistantRuntimeProvider>
  );
}

function PlainText({ text }: { text: string }) {
  return <span className="whitespace-pre-wrap">{text}</span>;
}
