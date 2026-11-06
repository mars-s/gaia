import type { ReactNode } from "react";
import { StatusPill } from "./status-pill";
import { Button } from "./components/base/buttons/button";

export function ProposalCardContent({ title, status, body, children, primary, disabled, skipDisabled = disabled, onAccept, onDismiss }: {
  title: string;
  status: string;
  body: string;
  children?: ReactNode;
  primary: string;
  disabled?: boolean;
  skipDisabled?: boolean;
  onAccept(): void;
  onDismiss(): void;
}) {
  return <>
    <div className="proposal-heading">
      <h2 className="text-title-3-semibold">{title}</h2>
      <StatusPill>{status}</StatusPill>
    </div>
    <p className="setup-memory-caption text-caption-1-regular text-text-secondary">{body}</p>
    {children}
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" size="small" disabled={disabled} onClick={onAccept}>{primary}</Button>
      <button className="quiet-action text-text-secondary" disabled={skipDisabled} onClick={onDismiss}>Not now</button>
    </div>
  </>;
}
