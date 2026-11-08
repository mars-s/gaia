# Proposed, awaiting owner confirmation

This note is not locked SPEC text. No hosted provider or credential setting is enabled by this increment.

Proposed exception to "Plan sign-in, no API keys":

> Plan sign-in remains the only route for chat and content. An optional hosted provider may make intent decisions only, through Pi, using an owner-supplied API key held in Gaia's existing credential store with the same protections. The key must never appear in code, logs or the data directory in plain text. The owner sets a monthly spending cap, default US$10. Metering reserves the maximum cost before each request and stops hosted decisions at the cap. Without a key, at the cap or on provider failure, Gaia falls back to the plan model through Pi and the local matcher. Hosted decisions are disabled by default.

Pi 1.5.0 already supports `classify()` with `openai-decisions`, `typesafe-system-one`, and OpenRouter chat providers. Its `api/openai-decisions.js` posts to `/v1/decisions` and explicitly rejects ChatGPT subscription tokens. OpenRouter supports API-key chat models, but its bundled classifier catalogue is empty. A Jev-compatible classifier is provided directly under TypeSafe, rather than establishing Jev availability through OpenRouter. No exception to routing traffic through Pi is needed. Only the intent-only API-key exception needs confirmation.

Evidence is the installed, pinned `@earendil-works/pi-ai` 1.5.0 source: `dist/types.d.ts`, `dist/api/openai-decisions.js`, `dist/providers/data/typesafe.json`, `dist/providers/data/openai.json`, `dist/providers/openrouter.models.js` and `dist/env-api-keys.js`. These establish adapter capability, not live account access or a successful paid request. No credentials were read or copied.

Cost estimate, not a provider quote: 3,000 submitted intents per month, 1,000 input tokens and 100 output tokens each. At an assumed US$0.50 per million input tokens and US$2 per million output tokens, this is US$2.10 per month. At US$2 input and US$8 output, it is US$8.40. Per-keystroke hosted requests are excluded. At US$0.01 per decision the same usage costs US$30 and must stop after 1,000 decisions under the default cap. Actual model pricing and access must be checked before activation. A hard cap requires a provider-enforced maximum charge per call; a provider without one must remain disabled. Uncertain failed requests retain their reserved charge.
