import { StatusPill } from "../status-pill";
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
  channels: { label: "Shared channels" },
  sessions: { label: "Separate sessions" },
};

const setupChange = {
  single: "This becomes your main chat. One conversation keeps your shared memory, and your original chat stays available.",
  bots: "This becomes your main chat. Each Bot keeps its own memory and conversation, and your original chat stays available.",
  channels: "This becomes your main chat. Channels share remembered facts and keep separate conversations, and your original chat stays available.",
  sessions: "This becomes your main chat. Sessions keep separate histories and share new remembered facts, and your original chat stays available.",
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
              <div className="proposal-heading">
                <h2 className="text-title-3-semibold">{proposal.plan.title}</h2>
                <StatusPill>Proposed</StatusPill>
              </div>
              <p className="setup-memory-caption text-caption-1-regular text-text-secondary">
                {setupChange[proposal.plan.layout]}
              </p>
              <ul className="proposal-scopes">
                {proposal.plan.scopes.map((scope, index) => (
                  <li
                    key={index}
                    className="setup-scope-row"
                  >
                    {proposal.plan.layout === "bots" ? (
                      <BotAvatar avatar={scope.avatar} />
                    ) : (
                      <span className="avatar-tile"><SetupGlyph layout={proposal.plan.layout} /></span>
                    )}
                    <div className="setup-scope-copy">
                      <p className="shrink-0 text-body-medium">{scope.label}</p>
                      <p
                        className="scope-purpose"
                        title={scope.purpose}
                      >
                        {scope.purpose}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {errors?.get(proposal.id) && (
                <p role="alert" className="text-text-error-primary">
                  {errors.get(proposal.id)}
                </p>
              )}
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
              <p className="text-caption-1-regular text-text-secondary">
                Or tell me what to change.
              </p>
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
