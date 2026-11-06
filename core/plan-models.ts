import type { Models } from "@earendil-works/pi-ai";

export type PlanAvailability = { connectedProviders(): ReadonlySet<string> };
const noPlans: PlanAvailability = { connectedProviders: () => new Set() };
export function planModels(
  models: Models,
  availability: PlanAvailability = noPlans,
) {
  const connected = availability.connectedProviders();
  return models.getModels().filter((model) => connected.has(model.provider));
}
export function defaultPlanModel(
  models: Models,
  availability: PlanAvailability = noPlans,
) {
  const catalogue = planModels(models, availability);
  const preferences = [
    ["openai-codex", "gpt-6.1-sol"],
    ["anthropic", "claude-opus-5-5"],
    ["anthropic", "claude-sonnet-5-5"],
    ["anthropic", "claude-opus-5"],
    ["anthropic", "claude-sonnet-5"],
    ["anthropic", "claude-opus-4-8"],
    ["anthropic", "claude-sonnet-4-6"],
    ["anthropic", "claude-haiku-4-5"],
  ] as const;
  for (const [provider, modelId] of preferences) {
    if (
      catalogue.some(
        (model) => model.provider === provider && model.id === modelId,
      )
    )
      return { provider, modelId };
  }
  if (catalogue.length)
    throw new Error("Choose an available model before continuing.");
  return { provider: "openai-codex", modelId: "gpt-6.1-sol" };
}
