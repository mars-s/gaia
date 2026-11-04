import { readManaged } from "../../packages/sdk/managed.ts";

type ManagedView = Awaited<ReturnType<typeof readManaged>>;
export function watchManaged({
  read = readManaged,
  publish,
  fail,
  waitingFor,
  interval = 2000,
  limit = 150,
}: {
  read?: typeof readManaged;
  publish: (view: ManagedView) => void;
  fail: (message: string) => void;
  waitingFor?: string;
  interval?: number;
  limit?: number;
}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  async function refresh() {
    attempts++;
    let again: boolean;
    try {
      const view = await read(controller.signal);
      if (controller.signal.aborted) return;
      publish(view);
      if (!view) return;
      const target = view.changes.find((change) => change.id === waitingFor);
      again =
        view.status.busy ||
        view.changes.some(
          (change) =>
            change.outcome === "queued" || change.outcome === "checking",
        ) ||
        Boolean(
          waitingFor &&
          (!target ||
            target.outcome === "queued" ||
            target.outcome === "checking"),
        );
    } catch (cause) {
      if (controller.signal.aborted) return;
      fail(
        cause instanceof Error
          ? cause.message
          : "Changes are unavailable. Refresh to try again.",
      );
      again = true;
    }
    if (again && attempts < limit)
      timer = setTimeout(() => void refresh(), interval);
    else if (again)
      fail(
        "Changes are still being checked. Refresh history shortly for the result.",
      );
  }
  void refresh();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
