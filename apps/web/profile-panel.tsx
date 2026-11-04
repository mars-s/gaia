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
  const details =
    state.kind === "proposed" || state.kind === "ready"
      ? state.profile
      : undefined;
  return (
    <section
      aria-label="Owner setup"
      className="flex min-w-0 flex-col items-start gap-3 text-body-regular text-text-secondary"
    >
      {details ? (
        <>
          <h2 className="text-body-medium text-text-primary">
            {state.kind === "ready"
              ? "Saved owner profile"
              : "Proposed owner profile"}
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
                Review these details. They become your owner profile only when
                you select Save.
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
                  Continue editing
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
          <p>Want to tell Gaia a little about yourself? Setup is optional.</p>
          <Button
            variant="secondary"
            disabled={disabled}
            onClick={() => onAction("start")}
          >
            Start setup
          </Button>
        </>
      ) : null}
      {state.kind !== "ready" && state.kind !== "skipped" && (
        <Button
          className="quiet-action text-text-secondary"
          variant="ghost"
          size="small"
          disabled={skipDisabled}
          onClick={() => onAction("skip")}
        >
          {state.kind === "interview" || state.kind === "proposed"
            ? "Skip setup"
            : "Skip"}
        </Button>
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
                Forget profile only
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
              Reset or forget profile
            </Button>
          )}
        </>
      )}
    </section>
  );
}
