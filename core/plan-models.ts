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
  const model =
    catalogue.find(
      (model) =>
        model.provider === "openai-codex" && model.id === "gpt-6.1-sol",
    ) ?? catalogue[0];
  return model
    ? { provider: model.provider, modelId: model.id }
    : { provider: "openai-codex", modelId: "gpt-6.1-sol" };
}
