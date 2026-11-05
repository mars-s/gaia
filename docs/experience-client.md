# Shared experience client handover

This increment adds an opt-in Profiles entry under Account. The original chat and skipped setup remain the default. The implementation base is `de293bfab3f4b362c6b99ab58c10a8ff14bddd49`. The implementation commit containing this handover is identified by `git log -1 --format=%H -- docs/experience-client.md`.

## Boundaries and contracts

No protocol, runtime, auth, protected core, dependency or configuration file changed. The client consumes the frozen `packages/protocol/experiences.ts` shapes and the routes in `docs/experience-profiles.md`. The SDK exports `createExperienceClient` and its inferred `ExperienceClient` type. No existing SDK API changed.

The SDK validates requests and responses, including profile and scope identity. Scope events are raw full `ExperienceScopeState` JSON snapshots, not the legacy Home event envelope. Model and Compact return full scope state. Stop returns an exact `ExperienceJob`; retry returns a new `ExperienceAdmission`. These are integration requirements for the parallel runtime implementation. On SSE open, a state read recovers the snapshot. Revisions reject older snapshots. Reconnection backs off from 500 ms to 10 seconds, closes the old EventSource and aborts its recovery read. It does not cancel admitted work. Closing a subscription releases its timer and request. There is no idle watchdog because the frozen scope contract does not promise a heartbeat.

`apps/web/experiences/controller.ts` owns selection, subscriptions, profile confirmation, scope creation, draft persistence, image uploads, admission, settings queues and job actions. The shared UI exports `ProfileExperience` through `apps/web/experiences/index.tsx`. The deep conversation view reuses Gaia's Board UI controls, Markdown renderer, model and effort popover, plus menu and draft image previews. Legacy Composer and Transcript behaviour is unchanged. The app integration adds one mount, Account entry and release-readiness guard. It pauses experience subscriptions and pending client requests when disconnected or in safe mode.

## Behaviour

Proposing a profile creates a server proposal only. Review shows the exact title, layout, assistant identity, purpose, scopes, avatar IDs, UUID and revision. Confirm sends that displayed revision. Existing proposals from the backend appear in the same list. The client never treats typed agreement as confirmation.

Central chat has no collection navigation. Bots use avatar and name rows with separate scope identities. Channels use one assistant identity, channel markers and a shared-memory explanation. Sessions have a real New session request and retain earlier scope rows. Collection creation is refused locally for central chat. All four layouts use the same transcript and composer.

Sending waits for the selected draft's own image reads, admission or queued model choice, never an already admitted job. Another scope can send while admission is pending elsewhere. Stop names an exact job ID. Completed activities disappear; failed, stopped, interrupted and uncertain attempts remain truthful. Only uncertain retry asks whether to repeat a possibly completed effect. Citation links come from completed job receipts. Activity descriptions come directly from real running or stopping job activity, with an independent avatar row per activity. There are no rotating phrases, simulated timers or raw tool displays.

Draft and image storage keys contain both profile and scope UUIDs. The existing IndexedDB draft engine retains request identity after a failed admission, clears only the admitted snapshot, and preserves a newer edit or image read. Uploads use the originating scope. Model changes have separate queues per scope. Revision checks stop older command responses replacing newer scope state. Profile reads, scope creation and stream generations cannot redirect a newer selection. Drafts remain cached through reconnect. A memory-only draft blocks managed reload and exposes Retry saving. Reused draft previews revoke their object URLs on cleanup.

## Assets

Eight unmodified DiceBear Voxel Bot SVGs are served locally as `bot-00` through `bot-07`. Unknown IDs use the local `bot-00` fallback. The official style page identifies the art as CC0 1.0:

- https://www.dicebear.com/styles/voxel-bot/
- https://creativecommons.org/publicdomain/zero/1.0/

`apps/web/public/bots/provenance.json` records each fixed public seed, official 10.x API URL, fetch date, licence and SHA-256 checksum. The major API version is pinned in the URL; the bytes and checksums pin this downloaded set. The style page linked its definition at version 10.6.0 when checked. XML inspection rejected script, foreignObject, image, iframe, event attributes and external href/src/CSS URL references. Internal fragment references are necessary for these official SVGs and are retained. No owner labels went to the avatar service. This is DiceBear artwork, not xAI artwork. The additive public notice ships with the assets.

## Verification and limits

The installed `@earendil-works/pi-ai` package is 1.5.0. Its shipped declarations expose `onPayload` and `onProviderStreamEvent`. Pi Durable's installed declarations expose conversation ownership and background tasks. The client uses only protocol shapes, so it does not call Pi directly, patch dependencies or change pins.

Fifteen deterministic tests exercise concurrent send eligibility, admission failure, pending/new-edit image retention, scoped persisted drafts, storage failure and reload gating, profile/scope response ordering, reconnect and stale subscriptions, per-scope model queues and disposal, exact-job Stop, uncertain retry, exact revision confirmation, genuine scope creation, central-chat collection rejection, keyboard/IME guards and server-rendered layout/activity semantics. These use fixture transport and temporary persistence. Static React rendering verifies markup only, not visual acceptance or native interaction.

Required gates were run on this increment: `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npm test`, `npm run build`, `npm run check:protocol` and `git diff --check`. The mechanical Impeccable detector ran once over the changed UI and returned `[]`. Build warnings remain for existing use-client directives, sourcemap reporting and the large application chunk. The final full run completed 183 tests, with 182 passing, zero failures and one opt-in test skipped. All 15 new client tests passed.

No real provider request, live owner store, credential, desktop application, browser launch, push or deployment was used. Parent integration must verify the new routes and scope SSE against the actual runtime. It must also check light/dark rendering, narrow navigation and focus, image previews, real Pi model/effort and Compact behaviour, live activity wording, scope memory isolation/sharing and native lifecycle acceptance. The client cannot establish backend concurrency, durable job ownership, search success, process cancellation or real memory semantics from fixtures.
