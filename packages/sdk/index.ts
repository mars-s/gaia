import { Snapshot, Event, ApiError } from "../protocol/index.ts";
export async function command(
  path: string,
  input: unknown = {},
  signal?: AbortSignal,
): Promise<Snapshot> {
  const response = await fetch(`/api/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(ApiError.parse(value).error);
  return Snapshot.parse(value);
}
export function subscribe(
  onState: (state: Snapshot) => void,
  onError: () => void,
) {
  let events: EventSource;
  let closed = false;
  let retry = 1000;
  let timer: ReturnType<typeof setTimeout>;
  let recovery: AbortController | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  let streamVersion = 0;

  async function recover() {
    recovery?.abort();
    clearTimeout(recoveryTimer);
    const controller = new AbortController();
    recovery = controller;
    const current = revision;
    const timeout = setTimeout(() => controller.abort(), 5000);
    recoveryTimer = timeout;
    try {
      const response = await fetch("/api/v1/state", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("State unavailable");
      const state = Snapshot.parse(await response.json());
      if (
        !closed &&
        !controller.signal.aborted &&
        current === revision &&
        recovery === controller
      )
        onState(state);
    } catch {
      if (!closed && current === revision && recovery === controller) onError();
    } finally {
      clearTimeout(timeout);
    }
  }

  function reconnect() {
    if (closed) return;
    streamVersion++;
    events.close();
    clearTimeout(timer);
    onError();
    void recover();
    timer = setTimeout(connect, retry);
    retry = Math.min(retry * 2, 10000);
  }

  function connect() {
    if (closed) return;
    events = new EventSource("/api/v1/events");
    const version = ++streamVersion;
    const active = () => !closed && streamVersion === version;
    // The server sends a snapshot every second, even while chat is idle.
    timer = setTimeout(reconnect, 10000);
    events.onopen = () => {
      if (active()) void recover();
    };
    events.onmessage = (event) => {
      if (!active()) return;
      try {
        const state = Event.parse(JSON.parse(event.data)).data;
        revision++;
        recovery?.abort();
        clearTimeout(recoveryTimer);
        retry = 1000;
        clearTimeout(timer);
        timer = setTimeout(reconnect, 10000);
        onState(state);
      } catch {
        reconnect();
      }
    };
    events.onerror = () => {
      if (active()) reconnect();
    };
  }
  connect();
  return () => {
    closed = true;
    revision++;
    events.close();
    recovery?.abort();
    clearTimeout(recoveryTimer);
    clearTimeout(timer);
  };
}

export function connectPlan(
  provider: import("../protocol/index.ts").PlanProvider,
) {
  return command("auth/connect", { provider });
}
export function disconnectPlan(
  provider: import("../protocol/index.ts").PlanProvider,
) {
  return command("auth/disconnect", { provider });
}
