import { z } from "zod";
import type { Snapshot } from "../../packages/protocol/index.ts";

type Model = NonNullable<Snapshot["chat"]>["models"][number];
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
const key = "gaia.recent-models.v1";
const history = z.array(z.string());

export function readRecentModels(storage: () => Storage = () => localStorage) {
  try {
    return [
      ...new Set(history.parse(JSON.parse(storage().getItem(key) ?? "[]"))),
    ];
  } catch {
    return [];
  }
}

export function rememberModel(
  id: string,
  recent: string[],
  storage: () => Storage = () => localStorage,
) {
  const next = [...new Set([id, ...recent])].slice(0, 4);
  try {
    storage().setItem(key, JSON.stringify(next));
  } catch {
    // Device storage may be unavailable. The picker still works for this visit.
  }
  return next;
}

export function modelMenu(models: Model[], selected: string, recent: string[]) {
  const available = new Map(models.map((model) => [model.id, model]));
  const missing = available.has(selected)
    ? undefined
    : { id: selected, name: selected };
  if (models.length <= 6)
    return { primary: missing ? [missing, ...models] : models, remaining: [] };
  const ids = [
    selected,
    ...[...new Set(recent)]
      .filter((id) => id !== selected && available.has(id))
      .slice(0, 3),
  ];
  const primary: (Model | { id: string; name: string })[] = models.filter(
    (model) => ids.includes(model.id),
  );
  if (missing) primary.unshift(missing);
  return {
    primary,
    remaining: models.filter((model) => !ids.includes(model.id)),
  };
}
