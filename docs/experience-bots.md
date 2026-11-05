# Bots acceptance

Home, Study and Work use the existing generic `bots` layout. Product names appear only in fixture configuration. The owner must confirm the exact proposal revision before any scope is created. Roles, histories and explicit memory remain separate.

`list_scopes` is an app-owned Pi tool. It resolves the calling job's profile and returns only scope IDs, labels, purposes and avatars from that profile. It returns no transcript, memory, job state or metadata from other profiles. Home can select a destination from this result and pass its ID to the existing `spawn_agent` and `wait_agent` tools. These tools still enforce parent ownership, three subordinate levels and eight children per job.

Generic scope creation assigns the first unused local avatar, reserving avatars explicitly selected in the proposal. An explicit scope avatar remains unchanged. The eight defaults are the existing `bot-00` through `bot-07` SVGs. After all eight are used, defaults reuse that local set. The files and their SHA-256 hashes are recorded in `apps/web/public/bots/provenance.json` under CC0-1.0. No assets were downloaded or replaced.

## Deterministic acceptance

`apps/server/experience-bots.test.ts` is discovered by `npm test`. It uses `apps/server/testing/experiences.ts`, real Pi tasks, temporary SQLite stores and public HTTP routes on ephemeral loopback ports. Faux provider responses drive actual tools. Assertions observe their results and persisted public state.

The four cases cover:

- Exact confirmation, legacy chat preservation, Home, Study and Work purposes, Sol 6.1 High defaults, eight distinct sourced avatars, added scopes, explicit avatar preservation, overflow reuse and reopen persistence.
- Home discovers Study from actual `list_scopes` output before any destination UUID enters a model response. Study receives its own role, history and explicit memory. It reads actual memory with provenance, completes a real subordinate job and returns that result through `wait_agent` to Home. Work context and another profile stay isolated. This also runs with concurrency one.
- Home cannot stop an unrelated Work job. Stopping Home joins its discovered Study child while Work continues and later completes. The held fixture tool is marked unsafe by the existing extension wrapper. Cancellation before its durable receipt leaves the child `uncertain`, with one outstanding invocation. The parent is stopped and no job remains active after Work finishes. This preserves truthful recovery semantics.
- Nine attempted Study delegations admit exactly eight children, return the actual subordinate-limit error for the ninth, and join all eight admitted jobs before Home completes.

The baseline run reproduced missing avatars, with one undefined avatar value instead of four distinct defaults. Home also failed destination discovery before the tool existed. Both scenarios passed after the generic defaults and metadata tool were added. An initial test incorrectly expected an unsafe cancelled child to be `stopped`; it was corrected to assert the existing `uncertain` contract. A later fixture variable rename was caught by typecheck and corrected.

## Scope and limits

This change adds no sidebar, dependency, provider, machine capability or managed feature. `package.json` and `package-lock.json` are unchanged. Dependencies were provisioned with the authorised `npm ci`. All fixture data is temporary. No owner data, credentials, protected-core source or native app was accessed.

The parent owns live subscription, native UI, browser drafts, machine tools and managed-generation acceptance. Deterministic Pi acceptance does not prove those surfaces. There was no push, PR or deployment.

Model the Domain kept the feature on existing profile, scope and job records, with a metadata projection rather than another routing registry. Architecture exploration and delegation were skipped because the bounded worker brief forbids children. Baseline reproduction preceded implementation. The worker's production edits are confined to a new tool, a small avatar helper and the generic scope creation block, separate from the parent extension factory and Duet memory changes.

Type System Discipline kept memory-result IDs derived from the public protocol schemas, so provenance comparisons preserve the existing branded IDs.

## Verification record

Before the worker commit, these commands passed:

- `npm run typecheck`
- `npm run typecheck:desktop`
- `npm run lint`
- `npm run build`, with Vite directive, source-map and bundle-size warnings
- `npm run check:protocol`
- `git diff --check` and `git diff --cached --check`
- Direct Bots tests: four passes, no failures or skips.
- Direct `apps/server/experience-machine.test.ts` rerun: five passes, no failures or skips.

The final `npm test` run completed with 227 tests: 225 passed, one failed, one existing opt-in provisioning proof skipped, and no cancellations. All four Bots cases passed. The remaining failure is the unchanged `timeout and cancellation kill and join descendants` case in `apps/server/experience-machine.test.ts`. Its guardian reported: `Guardian stopped unexpectedly. Its process group was terminated and joined; the external outcome is unknown.`, with `lifetime: joined`. It passed in isolation but failed in two full-suite runs, including a run without competing build commands. The cause is unresolved and outside this worker's allowed paths. The full gate is not green.

An earlier full run also received `ECONNREFUSED` in the protected-core `three actual child crashes trigger pinned safe chat` case. That case passed in the final run. No protected-core or machine implementation was changed. The parent must reconcile the remaining guardian failure before treating the batch as fully verified.

The final full-suite log is `/tmp/gaia-bots-test-quiet.log`. The build log is `/tmp/gaia-bots-build-final.log`. The earlier full-suite log is `/tmp/gaia-bots-test-final.log`.

A final combined rerun of the Bots and machine test files passed all nine tests together. This does not erase the full-suite guardian failure.
