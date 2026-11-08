# Proposed, awaiting owner confirmation

This note is not locked SPEC text. No hosted provider or credential setting is enabled by this increment.

Proposed exception to "Plan sign-in, no API keys":

> Plan sign-in remains the only route for chat and content. An optional hosted provider may make intent decisions only, through Pi, using an owner-supplied API key held in Gaia's existing credential store with the same protections. The key must never appear in code, logs or the data directory in plain text. The owner sets a monthly spending cap, default US$10. Metering reserves the maximum cost before each request and stops hosted decisions at the cap. Without a key, at the cap or on provider failure, Gaia falls back to the plan model through Pi and the local matcher. Hosted decisions are disabled by default.

Pi 1.5.0 already supports `classify()` with `openai-decisions`, `typesafe-system-one`, and OpenRouter chat providers. Its `api/openai-decisions.js` posts to `/v1/decisions` and explicitly rejects ChatGPT subscription tokens. OpenRouter supports API-key chat models, but its bundled classifier catalogue is empty. A Jev-compatible classifier is provided directly under TypeSafe, rather than establishing Jev availability through OpenRouter. No exception to routing traffic through Pi is needed. Only the intent-only API-key exception needs confirmation.

Evidence is the installed, pinned `@earendil-works/pi-ai` 1.5.0 source: `dist/types.d.ts`, `dist/api/openai-decisions.js`, `dist/providers/data/typesafe.json`, `dist/providers/data/openai.json`, `dist/providers/openrouter.models.js` and `dist/env-api-keys.js`. These establish adapter capability, not live account access or a successful paid request. No credentials were read or copied.

Cost checked against [OpenAI's Decisions guide](https://developers.openai.com/api/docs/guides/decisions) on 8 November 2026: `gpt-6-luna` costs US$0.10 per million uncached input tokens, with no output charge. At 3,000 submitted intents per month and 1,000 input tokens each, the base estimate is US$0.30 per month. At 10,000 tokens each it is US$3.00. This excludes regional and long-context premiums and cache-write charges. Per-keystroke hosted requests are excluded. Confirm the applicable processing tier and any premiums before activation. Pi's pinned classifier catalogue agrees with the base input price. No paid request was made.

A hard cap requires a defensible maximum charge per call. A provider without one must remain disabled. Uncertain failed requests retain their reserved charge. The implementation is an injectable seam only, with a fake hosted provider, an injected plan-model callback and the local matcher. It is not wired into the live Pi chat or a credential setting. Actual Pi calls, keychain access and activation await confirmation and the model-wiring phase.
