import type { Models } from "@earendil-works/pi-ai";

const availability = new WeakMap<Models, (provider: string) => boolean>();
export function registerPlanAvailability(
  models: Models,
  connected: (provider: string) => boolean,
) {
  availability.set(models, connected);
}
export function planModels(models: Models) {
  const connected = availability.get(models);
  return models
    .getModels()
    .filter((model) => !connected || connected(model.provider));
}
export function defaultPlanModel(models: Models) {
  const catalogue = planModels(models);
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
