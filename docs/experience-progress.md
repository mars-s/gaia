# Experience progress projection

This change keeps the existing independent job runtime and public protocol. It adds no stored fields, SQL tables or event store. Existing profile documents, owner confirmation, GOOD snapshots and recovery formats remain unchanged.

## Proposal receipt

`propose_experience` still creates and memoises the actual proposal. The public experience index retains its ID, exact revision and full plan for owner review. Only exact owner confirmation creates scopes. The model receives a receipt containing status (`awaiting-review` or `ready`), title, layout and conversation labels/count. The receipt contains no proposal ID or revision. Existing historical tool results are retained.

The runtime test captures the raw tool result from Pi's next model request. Its receipt assertion fails on baseline `6e60bd4`, which returned the whole proposal. The test obtains the actual proposal from the public index, rejects a stale revision, proves scopes are absent, then confirms the exact revision.

## Interim text evidence

Temporary fixtures use installed Pi Durable and Pi AI 1.5.0 with the faux streaming provider. A response emits acknowledgement text before an actual held fixture tool. Public scoped state and an HTTP SSE snapshot expose the acknowledgement while that tool is running, with its task-specific activity. Completion replaces that text in the same assistant message. Provider failure, Stop and close/reopen retain the last delivered interim text in that same message.

Baseline runs produced 14 to 16 profile publications before release for a 4,831-character acknowledgement. These counts include job admission, text, activity and tool receipt changes, rather than SQLite write counts. After coalescing and activity deduplication the same three cases each produced five publications before release, a reduction of roughly 64 to 69 percent in those local runs. Under the full concurrent suite the three cases produced 5, 6 and 6 publications; the provider-failure case produced 7. Timing and provider chunk sizes affect these integration counts; the controlled clock test below gives the precise write bound. Pi's live watch did not deliver all trailing pre-tool characters in these runs. This test proves interim visibility, not lossless pre-tool transcript delivery. The final assistant response is read from Pi's committed answer and projected exactly. No redundant public `running.partialText` was added.

## Coalescing

Text uses a leading update followed by at most one intermediate projection per 250 ms. Each projection stores the latest delivered text in the existing job and answer message together. Settlement, failure and abort flush the pending value and join storage writes before terminal handling. Job completion and quiesce therefore join pending projection work before store closure. Duplicate text values do not write again.

Activity comparison happens before calling `mutate`, so unchanged activity arrays no longer advance the profile revision or publish on every generation update. Real activity start, description changes and finish remain immediate and bypass the text timer. The stored 160-character activity limit is unchanged.

A controlled clock test supplies 100 distinct updates over one second and observes five writes, including the trailing value, instead of 100 writes. Additional tests hold a storage write open to prove `finish` joins it, flush exact final text before the next timer, reject callbacks after finish and propagate storage failure to the abort handler.

## Limits and founder decisions

These are projection changes, not a foreground/background engine implementation. They do not decide activity retention, Thinking versus avatar display, proposal card actions, main-chat migration, cross-session memory or model catalogue curation. Those remain founder decisions. No UI, live subscription, OAuth, native app or production acceptance is claimed. The tests use temporary SQLite data and loopback fixture ports only.

## Verification record

Receipt commit `de7bcb5` passed typecheck, desktop typecheck, lint, the full test suite (252 passed, one existing opt-in skip), build, protocol conformance and `git diff --check`. Before the receipt change, the new raw-output assertion failed on the full proposal including its ID and revision.

The first full projection run passed the new streaming tests but failed the existing managed-recovery suite under heavy concurrent machine load. Sandbox boot hit `Integration deadline exceeded`, then the parent reached its 600-second deadline and cancelled later checks. That run is a failure, not acceptance evidence. A full serial retry uses `npm test -- --test-concurrency=1`, with unchanged code, tests and deadlines.

The parent subsequently directed workers not to start more full retries while suites contend for the machine. The serial retry above was already running when that direction arrived. Preserve `/tmp/gaia-progress-projection-tests.log` for the failed run and `/tmp/gaia-progress-serial-tests.log` for that in-flight retry. The parent owns final managed integration and the combined full suite before landing or activation. No timeout or protected code was changed to mask the load issue.

The already-running serial retry completed with 260 passed, one existing opt-in skip, zero failures and zero cancellations. Build and protocol conformance then passed. Typecheck, desktop typecheck and lint had passed against the same implementation before that retry. The eight new progress tests passed, covering four actual Pi streaming settlement paths and four controlled projection cases. This local result does not replace the parent's combined verification gate.
