import { SettingsHeading } from "./settings-index";
import { RiRefreshLine } from "@remixicon/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import type { Snapshot } from "../../packages/protocol/index.ts";
import {
  revertChange,
  type ManagedChange,
  type ManagedStatus,
} from "../../packages/sdk/managed.ts";
import { watchManaged } from "./managed-history";

type View =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; status: ManagedStatus; changes: ManagedChange[] };

export function ManagedSettings({ runtime }: { runtime: Snapshot["runtime"] }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [waitingFor, setWaitingFor] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);

  useEffect(() => {
    if (submitting) return;
    const current = ++revision.current;
    return watchManaged({
      waitingFor,
      publish(value) {
        if (current !== revision.current) return;
        setError("");
        setView(value ? { kind: "ready", ...value } : { kind: "unavailable" });
      },
      fail(message) {
        if (current === revision.current) setError(message);
      },
    });
  }, [
    refresh,
    waitingFor,
    submitting,
    runtime?.mode,
    runtime?.selfModification,
  ]);

  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );

  const safe =
    runtime?.mode === "safe" ||
    (view.kind === "ready" &&
      (view.status.kind === "safe" || !view.status.selfModification));
  const target =
    view.kind === "ready"
      ? view.changes.find((change) => change.id === waitingFor)
      : undefined;
  const waiting = Boolean(
    waitingFor &&
    (!target || target.outcome === "queued" || target.outcome === "checking"),
  );
  const disabled =
    submitting ||
    waiting ||
    safe ||
    Boolean(error) ||
    view.kind !== "ready" ||
    view.status.busy;

  async function revert(id: string) {
    if (disabled || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    revision.current++;
    setSubmitting(true);
    setActionError("");
    try {
      const change = await revertChange(id, controller.signal);
      if (controller.signal.aborted) return;
      setWaitingFor(change.id);
      setView((value) =>
        value.kind === "ready"
          ? {
              ...value,
              changes: [
                change,
                ...value.changes.filter((entry) => entry.id !== change.id),
              ],
            }
          : value,
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setActionError(
          cause instanceof Error
            ? cause.message
            : "Revert could not be queued. Refresh history before trying again.",
        );
    } finally {
      request.current = null;
      if (!controller.signal.aborted) {
        setSubmitting(false);
        setRefresh((value) => value + 1);
      }
    }
  }

  return (
    <section className="settings-section" aria-labelledby="changes-title">
      <div className="flex items-center justify-between gap-3">
        <SettingsHeading id="changes-title">Change history</SettingsHeading>
        <button
          className="quiet-action refresh-changes"
          aria-label="Refresh changes"
          disabled={submitting}
          onClick={() => {
            setActionError("");
            setRefresh((value) => value + 1);
          }}
        >
          <RiRefreshLine className="size-4" aria-hidden />Refresh
        </button>
      </div>
      <p className="changes-caption">
        Updates Gaia has made to itself. You can undo applied updates here.
      </p>
      {view.kind === "loading" && (
        <p className="text-text-secondary">Loading changes…</p>
      )}
      {view.kind === "unavailable" && !runtime && (
        <p className="text-text-secondary">No changes yet.</p>
      )}
      {safe && (
        <p role="status" className="text-caption-1-regular text-text-secondary">
          Safe mode. Changes are disabled. You can still chat. Review the
          failures with the person running Gaia.
          {view.kind === "ready" && view.status.reason
            ? ` ${view.status.reason}`
            : ""}
        </p>
      )}
      {view.kind === "unavailable" && runtime && (
        <p role="status" className="text-caption-1-regular text-text-secondary">
          Change history is unavailable. Refresh after reconnecting.
        </p>
      )}
      {(error || actionError) && (
        <p
          role="alert"
          className="text-caption-1-regular text-text-error-primary"
        >
          {actionError || error}
        </p>
      )}
      {view.kind === "ready" && (
        <>
          {(submitting || waiting || view.status.busy) && (
            <p
              role="status"
              className="text-caption-1-regular text-text-secondary"
            >
              A change is being checked. The result will appear here.
            </p>
          )}
          {view.changes.length === 0 && (
            <p className="text-text-secondary">No changes yet.</p>
          )}
          <ul className="flex min-w-0 flex-col gap-6">
            {view.changes.map((change) => (
              <li
                key={change.id}
                className="flex min-w-0 flex-col gap-2 wrap-anywhere"
              >
                <p className="text-body-medium">{change.reason}</p>
                <p className="text-caption-1-regular text-text-secondary">
                  {change.outcome === "queued"
                    ? "Queued for checks"
                    : change.outcome}
                </p>
                <p className="text-caption-1-regular text-text-secondary">
                  {change.detail}
                </p>
                <details className="text-caption-1-regular text-text-secondary">
                  <summary className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                    Diff and checks
                  </summary>
                  <div className="mt-3 flex min-w-0 flex-col gap-3">
                    <p>{change.at}</p>
                    {change.checks.length ? (
                      <ul className="flex flex-col gap-2">
                        {change.checks.map((check, index) => (
                          <li key={index} className="whitespace-pre-wrap">
                            {check}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No check receipts recorded.</p>
                    )}
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap wrap-anywhere">
                      {change.diff || "No diff recorded."}
                    </pre>
                  </div>
                </details>
                {change.outcome === "accepted" && (
                  <Button
                    className="self-start"
                    variant="secondary"
                    size="small"
                    disabled={disabled}
                    onClick={() => void revert(change.id)}
                  >
                    Revert
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
