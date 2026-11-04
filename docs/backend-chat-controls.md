# Backend chat controls

The Pi adapter exposes the registered `openai-codex` model catalogue and the root conversation's durable model selection. The initial model is `gpt-6.1-sol`. Selection uses Pi's existing conversation configuration and survives reopening the same data directory, including release rollback. Gaia adds no model preference table. The legacy `connection.model` field remains the sign-in descriptor. Clients use `chat.modelId` for the selected model.

## Snapshot metadata

`GET /api/v1/state`, SSE snapshot events and command responses include optional `chat` metadata:

```ts
chat?: {
  models: { id: string; name: string; contextWindow: number }[];
  modelId: string;
  compaction: {
    kind: "idle" | "running" | "done" | "noop" | "error";
    message?: string;
  };
}
```

Adapters without all three optional `controls()`, `configure(modelId)` and `compact(signal)` methods omit `chat`. Their control commands return 409. Existing deterministic managed-core adapters remain supported.

## Commands

Both commands require `Content-Type: application/json` and the existing trusted host, origin and same-site checks. Invalid bodies return 400. Release admission checks still apply. Neither command reconnects or changes authentication.

- `POST /api/v1/model` accepts exactly `{ "modelId": string }`. The non-empty ID is at most 256 characters and must appear in the registered OpenAI catalogue. Success returns 202 with a snapshot after Pi has persisted the selection. The next turn uses that model.
- `POST /api/v1/compact` accepts exactly `{}`. A connected account is required. Success returns 202 with a running snapshot, then publishes the result through SSE and state reads. A running snapshot is admission, not evidence that a summary exists.

Model changes reserve the active operation before awaiting durable configuration. While an operation is active, send, retry, model changes and another compact return 409. Compaction sets `thread.run` to `{ kind: "running", id: UUID }` and `chat.compaction.kind` to `running`. This lets the existing supervisor drain wait for it. No message is added or removed. Clients can label Stop using the compaction metadata.

Pi's completed compaction task can return no summary. This produces `noop` with `No older context to compact.` A returned summary submission must reach `done` before Gaia publishes `done`. Failure produces `error` with a public message. Failure and no-op restore `thread.run` to idle and leave visible history unchanged.

`POST /api/v1/stop` aborts the actual compaction task. Gaia retains the running state until the task and provider settle, then publishes `error` with `Compaction stopped.` Shutdown aborts and joins the same operation before closing storage. A restart marks interrupted work as a recoverable thread error. Compaction status itself starts at idle after restart.

Production keeps Pi's default compaction policy, including `keepRecentTokens: 20000`. Backend tests inject a small retention threshold into the real harness and use deterministic test-only providers. They perform no real model requests.
