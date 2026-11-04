import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthBrowserFlow } from "./browser-auth.ts";

test("SSE replays and StrictMode effect replay open one tab per sign-in URL", async () => {
  const urls: string[] = [];
  let finish: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const flow = createAuthBrowserFlow(async (url) => {
    urls.push(url);
    await waiting;
  });
  const connecting = {
    kind: "connecting",
    url: "https://auth.openai.com/oauth/authorize?state=first",
  } as const;
  const first = flow(connecting);
  await flow(connecting);
  await flow({ ...connecting, prompt: "Paste the code" });
  assert.deepEqual(urls, [connecting.url]);
  finish();
  await first;
  await flow({ kind: "connected", model: "gpt-6.1-sol" });
  await flow(connecting);
  assert.deepEqual(urls, [connecting.url, connecting.url]);
});

test("a blocked browser open waits for explicit retry rather than opening on every snapshot", async () => {
  let attempts = 0;
  const flow = createAuthBrowserFlow(async () => {
    attempts++;
    throw new Error("Blocked");
  });
  await flow({ kind: "connecting" });
  assert.equal(attempts, 0);
  const connection = {
    kind: "connecting",
    url: "https://auth.openai.com/oauth/authorize",
  } as const;
  await assert.rejects(flow(connection), /Blocked/);
  await flow(connection);
  assert.equal(attempts, 1);
  await flow({ kind: "disconnected", message: "Sign in" });
  await assert.rejects(flow(connection), /Blocked/);
  assert.equal(attempts, 2);
});
