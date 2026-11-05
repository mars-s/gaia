import type {
  Experience,
  ExperienceId,
} from "../../../packages/protocol/experiences.ts";
import { Button } from "../components/base/buttons/button";

export function ExperienceProposalNotice({
  proposals,
  disabled,
  onReview,
}: {
  proposals: Experience[];
  disabled: boolean;
  onReview: (id: ExperienceId) => void;
}) {
  const pending = proposals.filter((proposal) => proposal.kind === "proposed");
  if (!pending.length) return null;
  return (
    <section
      aria-label="Proposed chat setup"
      className="flex flex-col gap-3 py-4"
    >
      {pending.map((proposal) => (
        <article
          key={proposal.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-separator-border p-4"
        >
          <div className="min-w-0 flex-1">
            <p className="break-words text-body-medium">
              {proposal.plan.title}
            </p>
            <p className="text-caption-1-regular text-text-secondary">
              Your proposed setup is ready to review.
            </p>
          </div>
          <Button
            variant="secondary"
            size="small"
            disabled={disabled}
            onClick={() => onReview(proposal.id)}
          >
            Review setup
          </Button>
        </article>
      ))}
    </section>
  );
}
