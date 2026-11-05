# Conversation engine decisions

The v1.5 founder reconciliation keeps the working independent-job runtime. These are experiment gates, not claims that the measurements have passed. Sol records results before a storage or engine change. Existing recovery, isolation, receipt and protocol tests remain requirements.

## Compatibility

Write synthetic data with an unknown task kind, an unknown document kind, optional Fact and Message fields, and setup sidecars. Open it using the GOOD-equivalent recovery registry without provider access. New kinds may ship only if recovery aborts them with zero provider calls and ignores the other additions. Otherwise a tolerant reader must reach GOOD before a writer is enabled. Never test this against owner data.

## Shared store contention

Compare 16 streaming workers in one store against per-profile stores, with text coalescing enabled. A shared store is eligible only with p95 commit latency at or below 50 ms, p99 at or below 200 ms and no busy errors. Otherwise keep per-profile stores. These are recorded experiment thresholds, not timing assertions in CI.

## Streaming cost

Measure at 50, 500 and 2,000 messages, both with and without a 12 MB desktop receipt. At 2,000 messages, p95 delta-to-SSE latency at or below 150 ms and at most 1 MB/s written means no storage change is required.

If only the receipt case fails, move receipt bodies and image bytes to the existing file storage. Do not add SQL tables. If the case without the receipt also fails, evaluate per-scope documents after the compatibility gate passes.

At 500 messages, more than 10 KB delivered to a viewer of conversation B for each token streamed in conversation A requires an additive per-scope stream revision.

## Follow-up continuity

Start a 30-second job, then send "actually, stop that". If the second request cannot see the first, add a small same-scope tool to read and wait on pending jobs. Consider foreground and background lanes only if that tool still fails this case and contention or streaming cost still fail after receipt storage and stream fan-out fixes.

## Convergence

Moving the earlier chat into a setup is a separate, explicit owner-confirmed copy. Keep the original Thread row untouched and provide a reversible selection. Retire the internal duplicate engines and composer only after managed acceptance, compatibility and performance decisions are complete, and the owner has selected a setup as main.

Public areas APIs remain supported until their callers migrate. Hide the old proposal tool when setups are enabled to avoid two competing setup flows. Removing public APIs requires the protocol version decision promised by `SPEC.md`.

## Deferred hosting work

The current machine host runs on the local Mac. A Linux homelab server will need client-offered Mac tools over the public protocol. Provider-qualified model IDs also need a compatibility plan before public protocol release. Neither change replaces the current Pi subscription backend.
