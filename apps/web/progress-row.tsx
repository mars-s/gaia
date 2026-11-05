import { useEffect, useState, type ReactNode } from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import { Button } from "./components/base/buttons/button";

export function ProgressRow({
  active,
  avatar = <span className="gaia-mark" aria-hidden="true" />,
  description,
  startedAt,
  children,
  error = false,
}: {
  active: boolean;
  avatar?: ReactNode;
  description?: string;
  startedAt?: string;
  children?: ReactNode;
  error?: boolean;
}) {
  const [observedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  const start = startedAt ? Date.parse(startedAt) : observedAt;
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return (
    <div
      className={
        error
          ? "progress-row chat-notice reply-error"
          : "progress-row chat-notice"
      }
    >
      {error ? (
        <RiErrorWarningLine className="reply-error-icon" aria-hidden="true" />
      ) : (
        avatar && (
          <span className="progress-avatar" aria-hidden="true">
            {avatar}
          </span>
        )
      )}
      {active && (
        <span className="working-indicator" aria-label="Reply in progress">
          <i />
          <i />
          <i />
        </span>
      )}
      {description && (
        <span className="min-w-0 truncate" title={description}>
          {description}
        </span>
      )}
      {active && seconds >= 3 && (
        <span
          className="progress-elapsed"
          aria-label={`${seconds} seconds elapsed`}
        >
          {seconds}s
        </span>
      )}
      {children}
    </div>
  );
}

export function ReplyNotice({
  message,
  onRetry,
  disabled,
}: {
  message: string;
  onRetry?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="reply-notice" role="alert">
      <ProgressRow active={false} description={message} error>
        {onRetry && (
          <Button
            variant="secondary"
            size="small"
            disabled={disabled}
            onClick={onRetry}
          >
            Try again
          </Button>
        )}
      </ProgressRow>
    </div>
  );
}

export function replyError(message: string): string {
  if (
    /connection lost|disconnected|network|fetch failed|ECONNRESET|ECONNREFUSED/i.test(
      message,
    )
  )
    return "Connection lost.";
  if (
    /sign.?in.*(?:expired|renew)|(?:token|session|authentication).*expired|unauthori[sz]ed|401/i.test(
      message,
    )
  )
    return "Your plan sign-in needs renewing. Reconnect in Settings.";
  if (
    /model.*(?:unavailable|not available|not found|not supported)|unknown model/i.test(
      message,
    )
  )
    return "That model isn't available now. Choose another to send.";
  return "Gaia couldn't finish that reply.";
}

export function OfflineNotice() {
  return (
    <p role="status" className="chat-notice offline-notice">
      <span aria-hidden="true" />
      Offline. Reconnecting… Your draft is safe.
    </p>
  );
}
