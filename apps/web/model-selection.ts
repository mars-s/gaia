import type { ModelSelection } from "../../packages/protocol/index.ts";

export function createModelSelectionQueue(
  apply: (selection: ModelSelection) => Promise<boolean>,
  changed: (selection: ModelSelection | undefined) => void,
  delay = 150,
) {
  let next: ModelSelection | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let disposed = false;
  async function flush() {
    if (running || disposed || !next) return;
    const selection = next;
    next = undefined;
    running = true;
    try {
      await apply(selection);
    } finally {
      running = false;
      if (!disposed) {
        if (next) timer = setTimeout(() => void flush(), delay);
        else changed(undefined);
      }
    }
  }
  return {
    select(selection: ModelSelection) {
      if (disposed) return;
      next = selection;
      changed(selection);
      clearTimeout(timer);
      timer = setTimeout(() => void flush(), delay);
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      next = undefined;
    },
  };
}
