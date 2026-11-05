import type {
  Experience,
  ExperienceId,
} from "../../../packages/protocol/experiences.ts";
import { Button } from "../components/base/buttons/button";
const layouts = {
  single: { label: "One conversation" },
  bots: { label: "Separate Bots" },
  channels: { label: "Shared assistant with channels" },
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
          className="flex min-w-0 flex-col gap-3 rounded-xl border border-separator-border p-4 wrap-anywhere"
        >
          {proposal.kind === "ready" ? (
            <>
              <p>Setup created.</p>
              <Button
                variant="ghost"
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
            </>
          ) : proposal.proposal?.supersededBy ? (
            <p className="text-text-secondary">Replaced by a newer setup.</p>
          ) : (
            <>
              <h2 className="text-body-medium">{proposal.plan.title}</h2>
              <p>
                {proposal.plan.assistantName} ·{" "}
                {layouts[proposal.plan.layout].label}
              </p>
              <p className="whitespace-pre-wrap">{proposal.plan.purpose}</p>
              <ul className="flex flex-col gap-3">
                {proposal.plan.scopes.map((scope, index) => (
                  <li key={index}>
                    <p className="text-body-medium">{scope.label}</p>
                    <p className="whitespace-pre-wrap text-text-secondary">
                      {scope.purpose}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="text-caption-1-regular text-text-secondary">
                Use this setup makes it your main chat. Earlier chat stays
                available.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="small"
                  disabled={disabled || pending?.has(proposal.id)}
                  onClick={() => onUse?.(proposal)}
                >
                  Use this setup
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={disabled || pending?.has(proposal.id)}
                  onClick={() => onDismiss?.(proposal)}
                >
                  Not now
                </Button>
              </div>
              <p className="text-caption-1-regular text-text-secondary">
                Or tell me what to change.
              </p>
            </>
          )}
          {errors?.get(proposal.id) && (
            <p role="alert" className="text-text-error-primary">
              {errors.get(proposal.id)}
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
