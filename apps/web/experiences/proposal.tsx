import { setupContext } from "../setup-context";
import { SetupGlyph } from "../setup-glyph";
import type {
  Experience,
  ExperienceId,
} from "../../../packages/protocol/experiences.ts";
import { RiCheckLine } from "@remixicon/react";
import { BotAvatar } from "./view";
import { Button } from "../components/base/buttons/button";
export const setupLayouts = {
  single: { label: "One conversation" },
  bots: { label: "Separate Bots" },
  channels: { label: "One assistant with channels" },
  sessions: { label: "Separate sessions" },
};

export function proposalsAfterAnswer(
  proposals: Experience[],
  answerId?: string,
  createdSetups: ReadonlySet<ExperienceId> = new Set(),
) {
  return proposals.filter((proposal) => {
    if (proposal.proposal?.dismissedAt) return false;
    if (answerId) return proposal.proposal?.answerMessageId === answerId;
    return (
      !proposal.proposal?.answerMessageId &&
      proposal.proposal?.source.kind !== "conversation" &&
      (proposal.kind === "proposed" || createdSetups.has(proposal.id))
    );
  });
}

export function ExperienceProposalNotice({
  proposals,
  disabled,
  onReview,
  onUse,
  onDismiss,
  errors,
  pending,
}: {
  proposals: Experience[];
  disabled: boolean;
  onReview?: (id: ExperienceId) => void;
  onUse?: (proposal: Experience) => void;
  onDismiss?: (proposal: Experience) => void;
  errors?: Map<ExperienceId, string>;
  pending?: Set<ExperienceId>;
}) {
  const visible = proposals.filter((p) => !p.proposal?.dismissedAt);
  if (!visible.length) return null;
  return (
    <section
      aria-label="Proposed chat setup"
      className="flex min-w-0 flex-col gap-3 py-4"
    >
      {visible.map((proposal) => (
        <article
          key={proposal.id}
          data-setup-answer={proposal.proposal?.answerMessageId}
          className="setup-card flex min-w-0 flex-col gap-4 rounded-xl border border-separator-border p-5 wrap-anywhere"
        >
          {proposal.kind === "ready" ? (
            <div className="flex flex-wrap items-center gap-3">
              <RiCheckLine className="size-5 shrink-0" aria-hidden="true" />
              <p className="mr-auto">Setup created.</p>
              <Button
                variant="secondary"
                size="small"
                disabled={disabled || pending?.has(proposal.id)}
                onClick={() => onReview?.(proposal.id)}
              >
                Open it
              </Button>
              {errors?.get(proposal.id) && (
                <Button
                  variant="secondary"
                  size="small"
                  disabled={disabled || pending?.has(proposal.id)}
                  onClick={() => onUse?.(proposal)}
                >
                  Try making it main again
                </Button>
              )}
            </div>
          ) : proposal.proposal?.supersededBy ? (
            <p className="text-text-secondary">Replaced by a newer proposal.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-title-3-semibold">{proposal.plan.title}</h2>
                <span className="text-caption-1-regular text-text-secondary">
                  Proposed
                </span>
              </div>
              <p className="whitespace-pre-wrap text-text-secondary">
                {setupLayouts[proposal.plan.layout].label}.{" "}
                {proposal.plan.purpose}
              </p>
              <p className="setup-memory-caption text-caption-1-regular text-text-secondary">
                {setupContext[proposal.plan.layout].change} Your original chat stays as it is.
              </p>
              <ul className="flex min-w-0 flex-col gap-2">
                {proposal.plan.scopes.map((scope, index) => (
                  <li
                    key={index}
                    className="setup-scope-row flex min-w-0 items-center gap-3"
                  >
                    {proposal.plan.layout === "bots" ? (
                      <BotAvatar avatar={scope.avatar} />
                    ) : (
                      <span className="avatar-tile"><SetupGlyph layout={proposal.plan.layout} /></span>
                    )}
                    <div className="setup-scope-copy min-w-0 flex-1">
                      <p className="shrink-0 text-body-medium">{scope.label}</p>
                      <p
                        className="truncate text-body-regular text-text-secondary"
                        title={scope.purpose}
                      >
                        {scope.purpose}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-caption-1-regular text-text-secondary">
                Using it makes this your main chat. Your original chat stays
                available.
              </p>
              {errors?.get(proposal.id) && (
                <p role="alert" className="text-text-error-primary">
                  {errors.get(proposal.id)}
                </p>
              )}
              <p className="text-caption-1-regular text-text-secondary">
                Or tell me what to change.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="primary"
                  size="small"
                  disabled={disabled || pending?.has(proposal.id)}
                  onClick={() => onUse?.(proposal)}
                >
                  {pending?.has(proposal.id) ? "Setting up…" : "Use this setup"}
                </Button>
                <button
                  className="quiet-action text-text-secondary"
                  disabled={disabled || pending?.has(proposal.id)}
                  onClick={() => onDismiss?.(proposal)}
                >
                  Not now
                </button>
              </div>
            </>
          )}
          {proposal.kind === "ready" && errors?.get(proposal.id) && (
            <p role="alert" className="text-text-error-primary">
              {errors.get(proposal.id)}
            </p>
          )}
        </article>
      ))}
    </section>
  );
}

export function interviewOfferAllowed(
  proposals: Experience[],
  latestAnswerId?: string,
): boolean {
  return !proposals.some(
    (item) =>
      (item.kind === "proposed" &&
        !item.proposal?.dismissedAt &&
        !item.proposal?.supersededBy) ||
      (Boolean(latestAnswerId) &&
        item.proposal?.answerMessageId === latestAnswerId),
  );
}
