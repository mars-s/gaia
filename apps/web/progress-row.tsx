import { useEffect, useState, type ReactNode } from "react";
import { Button } from "./components/base/buttons/button";

export function ProgressRow({
  active,
  avatar = <span className="gaia-mark" aria-hidden="true" />,
  description,
  startedAt,
  children,
}: {
  active: boolean;
  avatar?: ReactNode;
  description?: string;
  startedAt?: string;
  children?: ReactNode;
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
    <div className="progress-row chat-notice">
      {avatar && (
        <span
          className={
            active && !description ? "job-avatar-pulse" : "progress-avatar"
          }
          aria-hidden="true"
        >
          {avatar}
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
      <ProgressRow active={false} description={message}>
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
