import { randomUUID } from "node:crypto";
import { Event, Snapshot } from "../packages/protocol/index.ts";
import { waitHealth } from "./sandbox.ts";
export async function probes(
  base: string,
  release: string,
  token: string,
  timeout = 30000,
) {
  await waitHealth(base, release, timeout);
  const headers = { "Content-Type": "application/json", "X-Gaia-Probe": token };
  const requestId = randomUUID();
  const nonce = `Gaia readiness ${randomUUID()}`;
  const response = await fetch(`${base}/api/v1/probe/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: `Reply with exactly: ${nonce}`, requestId }),
    signal: AbortSignal.timeout(timeout),
  });
  if (response.status !== 202)
    throw new Error(
      `Scripted chat probe rejected (${response.status}); connect ChatGPT before promoting.`,
    );
  const until = Date.now() + timeout;
  let finished = false;
  while (Date.now() < until) {
    const res = await fetch(`${base}/api/v1/probe/state`, {
      headers,
      signal: AbortSignal.timeout(2000),
    });
    const value = Snapshot.parse(await res.json());
    if (value.thread.run.kind !== "running") {
      if (
        value.thread.run.kind !== "idle" ||
        !value.thread.messages.at(-1)?.text.includes(nonce)
      )
        throw new Error("Scripted chat probe failed");
      finished = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!finished) throw new Error("Scripted chat probe deadline exceeded");
  await reconnect(base, release);
}
export async function reconnect(base: string, release: string) {
  const events = await fetch(`${base}/api/v1/events`, {
    signal: AbortSignal.timeout(5000),
  });
  if (
    events.headers.get("X-Gaia-Release") !== release ||
    events.headers.get("Content-Type") !== "text/event-stream"
  )
    throw new Error("Reconnect identity failed");
  const reader = events.body?.getReader();
  if (!reader) throw new Error("Reconnect has no stream");
  try {
    let content = "";
    const decoder = new TextDecoder();
    while (!content.includes("\n\n")) {
      const part = await reader.read();
      if (part.done) throw new Error("Reconnect ended before snapshot");
      content += decoder.decode(part.value, { stream: true });
    }
    content += decoder.decode();
    const event = Event.parse(
      JSON.parse(content.split("\n")[0]?.slice(6) ?? ""),
    );
    if (event.data.runtime?.release !== release)
      throw new Error("Reconnect snapshot has wrong release");
    return event.data;
  } finally {
    await reader.cancel();
  }
}
