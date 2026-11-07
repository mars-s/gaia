import type { ComponentProps } from "react";
import { cx } from "../utils/cx";
import { usePreviewState } from "./preview";

type Variant = "primary" | "secondary" | "quiet" | "inline-link";
type ActionProps = ComponentProps<"button"> & { variant?: Variant; size?: "small" | "default" | "large"; tone?: "danger" };

/** An action in the shared button family. @example <Action variant="secondary">Open</Action> */
export function Action({ variant, size = "default", tone, className, ...props }: ActionProps) {
  const state = usePreviewState(undefined);
  const role = variant ?? (className?.includes("primary-action") ? "primary" : className?.includes("secondary-action") ? "secondary" : className?.includes("inline-link") ? "inline-link" : "quiet");
  return <button data-ui="action" data-variant={role} data-size={size} data-tone={tone} data-preview-state={state} {...props} className={cx(className ?? (role === "inline-link" ? role : `${role}-action`), tone === "danger" && "ui-danger")} />;
}

/** An icon action with a required accessible name. @example <IconButton label="Close">{icon}</IconButton> */
export function IconButton({ label, className, ...props }: Omit<ComponentProps<"button">, "aria-label"> & { label: string }) {
  const state = usePreviewState(undefined);
  return <button data-ui="icon-button" data-preview-state={state} {...props} aria-label={label} className={cx(className ?? "ui-icon-button")} />;
}
