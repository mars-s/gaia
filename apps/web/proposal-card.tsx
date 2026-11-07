import { Action } from "./ui";
import type { ReactNode } from "react";
import { StatusPill } from "./status-pill";
import { Button } from "./components/base/buttons/button";

export function ProposalCardContent({ title, status, body, children, primary, primaryLabel, compact = false, disabled, skipDisabled = disabled, onAccept, onDismiss }: {
  title: string;
  status: string;
  body: string;
  children?: ReactNode;
  primary: string;
  primaryLabel?: string;
  compact?: boolean;
  disabled?: boolean;
  skipDisabled?: boolean;
  onAccept(): void;
  onDismiss(): void;
}) {
  return <>
    <div className={compact ? "compact-proposal-copy" : "contents"}>
    <div className="proposal-heading">
      <h2 className="text-title-3-semibold">{title}</h2>
      <StatusPill>{status}</StatusPill>
    </div>
    <p className="setup-memory-caption text-caption-1-regular text-text-secondary">{body}</p>
    </div>
    {children}
    <div className="proposal-actions flex flex-wrap items-center gap-3">
      <Button aria-label={primaryLabel} variant="primary" size="small" disabled={disabled} onClick={onAccept}>{primary}</Button>
      <Action className="quiet-action text-text-secondary" disabled={skipDisabled} onClick={onDismiss}>Not now</Action>
    </div>
  </>;
}
