import { Action } from "./ui";
import { ProposalCardContent } from "./proposal-card";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import {
  nextOwnerQuestion,
  type OwnerState,
} from "../../packages/sdk/onboarding.ts";

export function ProfilePanel({
  state,
  failed,
  account,
  disabled,
  onAction,
  onRetry,
  showQuestion = false,
  skipDisabled = disabled,
}: {
  state?: OwnerState;
  failed: boolean;
  account: boolean;
  disabled: boolean;
  onAction: (action: string) => void;
  onRetry: () => void;
  showQuestion?: boolean;
  skipDisabled?: boolean;
}) {
  const [resetting, setResetting] = useState(false);
  if (failed)
    return (
      <div className="flex flex-col gap-2">
        <p role="alert">
          Profile could not be loaded. Chat is still available.
        </p>
        <Button variant="ghost" onClick={onRetry}>
          Retry profile
        </Button>
      </div>
    );
  if (!state) return null;
  if (!account && state.kind === "new")
    return (
      <section
        aria-label="About you"
        className="setup-card interview-offer flex min-w-0 flex-col gap-4 rounded-xl border border-separator-border p-4 wrap-anywhere"
      >
        <ProposalCardContent title="Fit Gaia around you" status="Optional" compact
          body="Answer three quick questions and Gaia will shape itself around how you work."
          primary="Start" primaryLabel="Start the short interview" disabled={disabled} skipDisabled={skipDisabled}
          onAccept={() => onAction("start")} onDismiss={() => onAction("skip")} />
      </section>
    );
  const details =
    state.kind === "proposed" || state.kind === "ready"
      ? state.profile
      : undefined;
  return (
    <section
      aria-label="About you"
      className="flex min-w-0 flex-col items-start gap-3 text-body-regular text-text-secondary"
    >
      {details ? (
        <>
          <h2 className="text-body-medium text-text-primary">
            {state.kind === "ready" ? "Saved details" : "Proposed details"}
          </h2>
          <dl className="grid max-w-full gap-2 wrap-anywhere">
            <div>
              <dt>Name</dt>
              <dd>{details.name}</dd>
            </div>
            <div>
              <dt>Purpose</dt>
              <dd>{details.purpose}</dd>
            </div>
            <div>
              <dt>Life areas</dt>
              <dd>{details.lifeAreas.join(", ") || "None specified"}</dd>
            </div>
            <div>
              <dt>Working style</dt>
              <dd>{details.workingStyle}</dd>
            </div>
            {details.approvalPreferences && (
              <div>
                <dt>Ask for approval</dt>
                <dd>{details.approvalPreferences}</dd>
              </div>
            )}
          </dl>
          {state.kind === "proposed" && (
            <>
              <p>
                Review these details. They are saved only when you select Save.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={disabled} onClick={() => onAction("confirm")}>
                  Save
                </Button>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onAction("edit")}
                >
                  Keep editing
                </Button>
              </div>
            </>
          )}
        </>
      ) : state.kind === "interview" ? (
        showQuestion ? (
          <p>{nextOwnerQuestion(state.answers)}</p>
        ) : null
      ) : account || state.kind === "new" ? (
        <>
          <p>
            {state.kind === "skipped"
              ? "You skipped the short interview. You can do it any time."
              : account
                ? "Tell Gaia a little about yourself so it can fit around how you work."
                : "Want me to fit Gaia around how you work? It takes a minute, and you can skip it."}
          </p>
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => onAction("start")}
          >
            {account ? "Start the short interview" : "Set up"}
          </Button>
        </>
      ) : null}
      {!account && state.kind !== "ready" && state.kind !== "skipped" && (
        <Action
          className="quiet-action text-text-secondary"
          disabled={skipDisabled}
          onClick={() => onAction("skip")}
        >
          {state.kind === "interview" || state.kind === "proposed"
            ? "Skip interview"
            : "Not now"}
        </Action>
      )}
      {account && state.kind !== "new" && (
        <>
          <p>
            Forgetting your profile retains conversation history. Details
            already in the conversation or model history are not erased.
          </p>
          {resetting ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => {
                  onAction("reset");
                  setResetting(false);
                }}
              >
                Forget these details
              </Button>
              <Button variant="ghost" onClick={() => setResetting(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => setResetting(true)}
            >
              Forget these details
            </Button>
          )}
        </>
      )}
    </section>
  );
}
