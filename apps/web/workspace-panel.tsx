import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";
import type {
  WorkspaceConfirmation,
  WorkspaceState,
} from "../../packages/sdk/workspace.ts";
import { homeScope, type ConversationScope } from "./workspace-controller";

export function WorkspaceProposalPanel({
  state,
  error,
  disabled,
  onConfirm,
  onRetry,
}: {
  state?: WorkspaceState;
  error: string;
  disabled: boolean;
  onConfirm: (input: WorkspaceConfirmation) => void;
  onRetry: () => void;
}) {
  if (state?.kind !== "proposed")
    return error ? (
      <p role="alert" className="text-caption-1-regular text-text-secondary">
        Workspace could not be loaded.{" "}
        <button type="button" className="quiet-link" onClick={onRetry}>
          Retry setup
        </button>
      </p>
    ) : null;
  const proposal = state.proposal;
  const workspace = proposal.workspace;
  return (
    <section
      aria-labelledby="workspace-proposal-title"
      className="my-4 flex min-w-0 flex-col items-start gap-3 rounded-2xl border border-border-button-default p-4 wrap-anywhere"
    >
      <h2 id="workspace-proposal-title" className="text-body-medium">
        {workspace.kind === "single"
          ? "Keep one conversation"
          : "Set up separate conversations"}
      </h2>
      {workspace.kind === "single" ? (
        <p>{workspace.purpose}</p>
      ) : (
        <dl className="flex flex-col gap-3">
          {workspace.areas.map((area) => (
            <div key={area.areaId}>
              <dt className="text-body-medium">{area.label}</dt>
              <dd className="text-text-secondary">{area.purpose}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-col gap-1 text-text-secondary">
        <p className="text-body-medium">Shared preferences</p>
        {proposal.sharedPreferences.length ? (
          <ul className="list-disc space-y-1 pl-5">
            {proposal.sharedPreferences.map((preference, index) => (
              <li key={index}>{preference}</li>
            ))}
          </ul>
        ) : (
          <p>None specified.</p>
        )}
      </div>
      <p className="text-caption-1-regular text-text-secondary">
        Review this setup. It takes effect only when you select Confirm setup.
      </p>
      {error && (
        <p role="alert" className="text-text-error-primary">
          {error}{" "}
          <button type="button" className="quiet-link" onClick={onRetry}>
            Refresh proposal
          </button>
        </p>
      )}
      <Button
        variant="secondary"
        disabled={disabled || Boolean(error)}
        onClick={() =>
          onConfirm({
            proposalId: proposal.proposalId,
            revision: proposal.revision,
          })
        }
      >
        Confirm setup
      </Button>
    </section>
  );
}

export function WorkspaceNavigation({
  state,
  selected,
  onSelect,
}: {
  state?: WorkspaceState;
  selected: ConversationScope;
  onSelect: (scope: ConversationScope) => void;
}) {
  if (state?.kind !== "confirmed" || state.proposal.workspace.kind !== "multi")
    return null;
  const options = [
    { scope: homeScope, label: "Home", purpose: "Home conversation" },
    ...state.proposal.workspace.areas.map((area) => ({
      scope: { kind: "area", areaId: area.areaId } satisfies ConversationScope,
      label: area.label,
      purpose: area.purpose,
    })),
  ];
  return (
    <nav
      aria-label="Conversations"
      className="workspace-nav flex shrink-0 gap-1 overflow-x-auto px-4 pb-2"
    >
      {options.map(({ scope, label, purpose }) => {
        const active =
          scope.kind === "home"
            ? selected.kind === "home"
            : selected.kind === "area" && selected.areaId === scope.areaId;
        return (
          <button
            key={scope.kind === "home" ? "home" : scope.areaId}
            type="button"
            title={purpose}
            aria-current={active ? "page" : undefined}
            className={cx(
              "max-w-48 shrink-0 truncate rounded-lg px-3 py-2 text-caption-1-medium text-text-secondary outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring",
              active && "bg-background-secondary-default text-text-primary",
            )}
            onClick={() => onSelect(scope)}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
