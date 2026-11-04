import { Snapshot, Event, ApiError } from "../protocol/index.ts";
export async function command(
  path: string,
  input: unknown = {},
): Promise<Snapshot> {
  const response = await fetch(`/api/v1/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(ApiError.parse(value).error);
  return Snapshot.parse(value);
}
export function subscribe(
  onState: (state: Snapshot) => void,
  onError: () => void,
) {
  const events = new EventSource("/api/v1/events");
  events.onmessage = (event) => {
    try {
      onState(Event.parse(JSON.parse(event.data)).data);
    } catch {
      onError();
    }
  };
  events.onerror = onError;
  return () => events.close();
}
