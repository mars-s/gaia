import { type ReactNode } from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import { Button } from "./components/base/buttons/button";

export function ProgressRow({
  active,
  avatar = <span className="gaia-mark" aria-hidden="true" />,
  description,
  children,
  error = false,
}: {
  active: boolean;
  avatar?: ReactNode;
  description?: string;
  children?: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={
        error
          ? "progress-row chat-notice reply-error"
          : "progress-row chat-notice"
      }
    >
      {!error && avatar && (
          <span className="progress-avatar" aria-hidden="true">
            {avatar}
          </span>
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
      {children}
    </div>
  );
}

export function ErrorMessage({ children, alert = true }: { children: ReactNode; alert?: boolean }) {
  return <span className="error-message">{alert && <RiErrorWarningLine className="reply-error-icon" aria-hidden="true" />}{children}</span>;
}

export function ReplyNotice({
  message,
  onRetry,
  disabled,
  onSettings,
}: {
  message: string;
  onSettings?: () => void;
  onRetry?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="reply-notice" role="alert">
      <ProgressRow active={false} error>
        <ErrorMessage>
          {message.includes("Settings") ? (
            <>
              {message.split("Settings")[0]}
              <button className="inline-link" onClick={onSettings}>
                Settings
              </button>
              .
            </>
          ) : (
            message
          )}
        </ErrorMessage>
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
      <FailurePath message={message} onSettings={onSettings} />
    </div>
  );
}

export function FailurePath({
  message,
  onSettings,
}: {
  message: string;
  onSettings?: () => void;
}) {
  if (message === "Couldn’t finish that reply.")
    return (
      <p className="failure-path">
        If this keeps happening, check your plan in{" "}
        <button className="inline-link" onClick={onSettings}>
          Settings
        </button>
        .
      </p>
    );
  if (message === "Connection lost.")
    return <p className="failure-path">Try again once you’re back online.</p>;
  return null;
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
    return "That model isn’t available now. Choose another to send.";
  return "Couldn’t finish that reply.";
}

export function OfflineNotice() {
  return (
    <p role="status" className="chat-notice offline-notice">
      <span aria-hidden="true" />
      Offline. Reconnecting… Your draft is safe.
    </p>
  );
}
