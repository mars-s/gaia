import type { ComponentProps, ReactNode } from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import { cx } from "../utils/cx";
import { Action } from "./actions";
import { usePreviewState } from "./preview";

/** A neutral or accent status, never an action. @example <StatusPill>Main chat</StatusPill> */
export function StatusPill({ tone = "neutral", children }: { tone?: "neutral" | "accent"; children: ReactNode }) {
  const state = usePreviewState(undefined);
  return <span data-ui="status-pill" data-preview-state={state} className="status-pill" data-tone={tone}>{children}</span>;
}

/** The proposal card family with body and action slots. @example <Card title="Tasks" body={list} actions={add} /> */
export function Card({ title, pill, body, actions, compact, children, className, ...props }: Omit<ComponentProps<"section">, "title"> & { title: ReactNode; pill?: ReactNode; body?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  const state = usePreviewState(undefined);
  return <section data-ui="card" data-preview-state={state} {...props} className={cx("setup-card", compact && "interview-offer", className)}><div className="proposal-heading"><h2 className="text-title-3-semibold">{title}</h2>{pill}</div>{body}{children}{actions && <div className="proposal-actions flex flex-wrap items-center gap-3">{actions}</div>}</section>;
}

/** A shared icon column with one or two text lines. @example <Row icon={icon} trailing={open}>Tasks</Row> */
export function Row({ icon, children, trailing }: { icon: ReactNode; children: ReactNode; trailing?: ReactNode }) {
  const state = usePreviewState(undefined);
  return <div className="ui-row" data-ui="row" data-preview-state={state}><span className="ui-row-icon">{icon}</span><div className="min-w-0 flex-1">{children}</div>{trailing}</div>;
}

/** A section title with optional caption and trailing action. @example <SectionHeading title="Tasks" caption="Today" /> */
export function SectionHeading({ title, caption, trailing }: { title: ReactNode; caption?: ReactNode; trailing?: ReactNode }) {
  const state = usePreviewState(undefined);
  return <div data-ui="section-heading" data-preview-state={state}><div className="ui-section-heading"><h2 className="text-title-3-semibold">{title}</h2>{trailing}</div>{caption && <p className="text-caption-1-regular text-text-secondary">{caption}</p>}</div>;
}

/** An empty composition with at most three suggestions. @example <EmptyState glyph={icon} text="No tasks yet." /> */
export function EmptyState({ glyph, text, starters = [] }: { glyph: ReactNode; text: string; starters?: { text: string; onSelect(): void }[] }) {
  const state = usePreviewState(undefined);
  return <div className="empty-chat" data-ui="empty-state" data-preview-state={state}><div className="empty-composition">{glyph}<h1 className="text-hero">{text}</h1>{starters.length > 0 && <ul className="starter-list" aria-label="Suggestions">{starters.slice(0, 3).map(item => <li key={item.text}><Action className="starter" onClick={item.onSelect}>{item.text}</Action></li>)}</ul>}</div></div>;
}

/** Quiet loading dots without a text prop. @example <Loading /> */
export function Loading() {
  const state = usePreviewState(undefined);
  return <span className="working-indicator" data-ui="loading" data-preview-state={state} aria-label="Loading"><i /><i /><i /></span>;
}

/** A known error or information line with recovery actions. @example <Notice tone="danger" message="Connection lost." retry={retry} /> */
export function Notice({ tone = "info", message, retry, secondPath }: { tone?: "danger" | "info"; message: string; retry?: () => void; secondPath?: ReactNode }) {
  const state = usePreviewState(undefined);
  return <div className="reply-notice" data-ui="notice" data-tone={tone} data-preview-state={state} role={tone === "danger" ? "alert" : "status"}><div className="progress-row chat-notice"><span className="error-message">{tone === "danger" && <RiErrorWarningLine className="reply-error-icon" aria-hidden />}{message}</span>{retry && <Action variant="secondary" onClick={retry}>Try again</Action>}</div>{secondPath && <p className="failure-path">{secondPath}</p>}</div>;
}
