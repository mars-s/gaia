import type { ReactNode } from "react";
import { Button } from "./components/base/buttons/button";

export function ProgressRow({
  active,
  avatar = <span className="gaia-mark" aria-hidden="true" />,
  description,
  children,
}: {
  active: boolean;
  avatar?: ReactNode;
  description?: string;
  children?: ReactNode;
}) {
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
