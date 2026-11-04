import {
  clampThinkingLevel,
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type ModelThinkingLevel,
} from "@earendil-works/pi-ai";

export function effortLevels(model: Model<Api>) {
  const levels = new Map<string, ModelThinkingLevel>();
  for (const level of getSupportedThinkingLevels(model)) {
    const providerLevel = model.thinkingLevelMap?.[level] ?? level;
    if (!levels.has(providerLevel) || level === providerLevel)
      levels.set(providerLevel, level);
  }
  return [...levels.values()];
}

export function supportedEffort(model: Model<Api>, level: ModelThinkingLevel) {
  const levels = effortLevels(model);
  if (levels.includes(level)) return level;
  const providerLevel = model.thinkingLevelMap?.[level];
  const alias =
    providerLevel &&
    levels.find(
      (candidate) =>
        (model.thinkingLevelMap?.[candidate] ?? candidate) === providerLevel,
    );
  return alias || clampThinkingLevel(model, "medium");
}
