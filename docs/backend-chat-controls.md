# Backend chat controls

The Pi adapter exposes the registered `openai-codex` model catalogue and the root conversation's durable model selection. The initial model is `gpt-6.1-sol`. Selection uses Pi's existing conversation configuration and survives reopening the same data directory, including release rollback. Gaia adds no model preference table. The legacy `connection.model` field remains the sign-in descriptor. Clients use `chat.modelId` for the selected model.

Effort uses Pi Durable 1.5.0's `root.configure({ model, thinkingLevel }, context)`. The resolved `root.agent()` supplies both values after reopening. The installed `pi-ai` `getSupportedThinkingLevels(model)` and `model.input.includes("image")` supply each model's capabilities. Gaia does not maintain a second catalogue. `clampThinkingLevel()` selects the nearest supported level when only the model changes. An explicit unsupported effort is rejected before configuration. The adapter also clamps an obsolete stored level on reopen.

Installed sources: `pi-durable/README.md` under Per-Conversation Agent, `dist/harness/types.d.ts` (`AgentChange`), `dist/harness/generation.js` (thinking level to provider `reasoning`), and `pi-ai/dist/models.js` (supported levels and clamp). These paths are relative to `node_modules/@earendil-works`.

## Snapshot metadata

`GET /api/v1/state`, SSE snapshot events and command responses include optional `chat` metadata:

```ts
chat?: {
  models: { id: string; name: string; contextWindow: number;
    capabilities?: { images: boolean; thinkingLevels: ThinkingLevel[] }
  }[];
  modelId: string;
  thinkingLevel?: ThinkingLevel;
  compaction: {
    kind: "idle" | "running" | "done" | "noop" | "error";
    message?: string;
  };
}
```

Adapters without all three optional `controls()`, `configure(modelId)` and `compact(signal)` methods omit `chat`. Their control commands return 409. Existing deterministic managed-core adapters remain supported.

## Commands

Both commands require `Content-Type: application/json` and the existing trusted host, origin and same-site checks. Invalid bodies return 400. Release admission checks still apply. Neither command reconnects or changes authentication.

- `POST /api/v1/model` accepts `{ "modelId": string, "thinkingLevel"?: ThinkingLevel }`, with no other fields. The non-empty ID is at most 256 characters and must appear in the registered OpenAI catalogue. `ThinkingLevel` is `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. Only values reported for that model are accepted. Success returns 202 after Pi persists the selection. The next turn uses it.
- `POST /api/v1/compact` accepts exactly `{}`. A connected account is required. Success returns 202 with a running snapshot, then publishes the result through SSE and state reads. A running snapshot is admission, not evidence that a summary exists.

Model changes reserve the active operation before awaiting durable configuration. While an operation is active, send, retry, model changes and another compact return 409. Compaction sets `thread.run` to `{ kind: "running", id: UUID }` and `chat.compaction.kind` to `running`. This lets the existing supervisor drain wait for it. No message is added or removed. Clients can label Stop using the compaction metadata.

New user messages retain an optional `selection` with `modelId` and `thinkingLevel`. Retry restores that selection while holding the operation reservation. Legacy messages without it use the current selection. Old text histories remain valid. The additions keep protocol version 1 and require no SQLite schema change. Protocol and tests are pinned by managed installations. An owner-authored protected installation upgrade is required before promotion, as described in `docs/chat-upgrade.md`.

Pi's completed compaction task can return no summary. This produces `noop` with `No older context to compact.` A returned summary submission must reach `done` before Gaia publishes `done`. Failure produces `error` with a public message. Failure and no-op restore `thread.run` to idle and leave visible history unchanged.

`POST /api/v1/stop` aborts the actual compaction task. Gaia retains the running state until the task and provider settle, then publishes `error` with `Compaction stopped.` Shutdown aborts and joins the same operation before closing storage. A restart marks interrupted work as a recoverable thread error. Compaction status itself starts at idle after restart.

Production keeps Pi's default compaction policy, including `keepRecentTokens: 20000`. Backend tests inject a small retention threshold into the real harness and use deterministic test-only providers. They perform no real model requests.
