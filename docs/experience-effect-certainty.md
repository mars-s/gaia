# Experience effect certainty

This change addresses started native effects whose processes stop before their external outcome is known. It uses Pi Durable and Pi AI 1.5.0, temporary profile databases and owned scratch files. No owner data, credentials, OAuth, native application or production service was used.

## Reproduction

On baseline `6e60bd4`, an actual `mac_shell` Node process appended its PID to an owned file, printed output and waited. After timeout, the process was gone but the job was `completed`, rather than review-required. The native timeout was a resolved error result, which the host stored as `failed`. The external wrapper then removed the pending invocation. A provider could continue and complete the job despite the unknown effect.

Owner Stop and server quiesce happened to produce uncertain jobs in the initial fixture. Their host receipts nevertheless said `cancelled`, despite the file write already having happened. This showed why the existing Stop test alone did not prove the settlement guarantee.

## Behaviour

- Trusted host registration classifies hosted search as `read`, and shell and desktop as `effect`. The classification uses tool object identity in a WeakMap. Tool arguments and arbitrary tool names cannot grant read-only treatment. Unclassified extensions remain conservative effects.
- A started native effect with a cancellation, timeout or owner-loss process result gets an `unknown` receipt. A thrown native failure after dispatch also remains unknown. The receipt retains the returned output, exit code, signal and process reason.
- The wrapper records unknown receipts without clearing their pending invocation. Settlement checks the transaction's current pending effects. Such jobs remain `uncertain`, and the existing retry route rejects an attempt without `repeatUncertain` with HTTP 409.
- Further native calls in that same job are rejected before dispatch, including after waiting for the desktop lease. Acknowledged retry creates a new job under the existing API contract.
- Trusted reads do not enter the list of potentially effectful pending invocations. Their cancelled receipts produce `stopped` or `interrupted` jobs and allow ordinary retry. Legacy unclassified pending records still require review.
- Desktop cancellation while queued before dispatch remains known `cancelled`, with `dispatched: false` and no second file write.
- Unknown outcome and unjoined process lifetime remain separate. The existing guardian/process implementation and shutdown join barrier are unchanged. A joined unknown effect permits clean shutdown; an unjoined process still blocks it.

## Compatibility and scope

Only optional JSON receipt fields, `effectClass` and `dispatched`, were added. Existing receipts without them parse unchanged. Old intents remain unknown unless explicitly classified read-only. No SQL tables, profile document schemas, registry task versions, protocol shapes, GOOD manifests, recovery code, auth code or dependencies changed. The existing legacy receipt/restart and managed schema/recovery tests remain in the full suite. Terminal records already written by an older release are not retrospectively reclassified.

The jobs.ts edit is confined to settlement. It does not change onText, activity extraction or projection. The Agent Desktop executable in the tests is an owned Node fixture that writes a scratch file and waits. It proves the host's desktop lease, dispatch, receipt and join paths, not acceptance of a real desktop application. Hosted search uses the actual installed search wrapper and Pi runtime with a controlled provider response, without external network or credentials.

## Evidence

The new top-level `experience-effect-certainty.test.ts` exercises both native tools across timeout, owner Stop, host-only quiesce, server quiesce and shutdown/reopen. Each checks the process PID is gone, the job requires review, the receipt retains output/status, retry gets 409 and the file has one write. Additional cases cover queued desktop cancellation, read-only search Stop and host quiesce, and a provider attempting a fresh tool call after an unknown effect.

The original focused batch passed 20 tests, including guardian-loss joined fallback and existing host integration. The expanded certainty file passed 15 tests without skips. Native tests use the existing owned-process capability probe to skip inside managed candidate sandboxes that forbid signalling. Those skips do not replace the direct unsandboxed lifecycle proofs.

The first full-suite attempt was stopped after nested candidate checks exposed missing sandbox guards in the new fixtures. Its owned temporary processes were cleaned up and the guards added before rerunning verification.

## Founder decision: retry after a known completed effect

The separate provider-failure probe deliberately completes a real scratch-file append, then returns a provider error. The job is `failed` with a completed native receipt. Ordinary retry returns HTTP 202 without `repeatUncertain`, creates a fresh worker, and can execute the append again. The observed file changes from `once\n` to `once\nonce\n`.

This is a known completed effect being repeated, not an unknown cancellation outcome. The current change preserves that existing policy. Opus and the master thread need to decide whether all failed jobs containing completed effects need an acknowledgement, or whether retry should resume after the known receipt. Either choice is broader than this safety fix and needs explicit product behaviour and acceptance tests. Do not advertise ordinary retry as deduplicating completed effects.

## Final verification and remaining limit

Before the implementation commit:

- `npm ci` provisioned this checkout from the exact lockfile. Dependency declarations and lockfile were unchanged.
- `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npm run build`, `npm run check:protocol` and `git diff --check` passed. Lint was rerun separately after an earlier concurrent scratch-directory cleanup race.
- `npx tsx --test apps/server/experience-effect-certainty.test.ts apps/server/experience-tools.test.ts apps/server/experience-host-integration.test.ts` passed all 22 tests, with no skips or cancellations. This final batch includes all 15 new certainty cases.
- `npm test` completed unsuccessfully: 268 tests, 255 passed, 10 failed, 2 cancelled and 1 skipped, in 833 seconds. The deliberate sandbox-boot and public-health rejection subtests reported `Integration deadline exceeded`. The managed integration parent reached its 600,000 ms timeout. Reconnect and subsequent cases then reported cancellation or that their parent had finished. This does not establish that the failures are unrelated to this change.

The isolated managed fixture's history showed the sandbox-boot attempt still `checking` after build, and the public-health attempt still `checking` with `Health probe deadline exceeded`. Other entries proved real source promotion, exact revert, scripted-chat rollback and schema-change rejection in the same run. Protected code was not changed to bypass these failures. The full log is `/tmp/gaia-effect-final-test.log`, and the final focused log is `/tmp/gaia-effect-final-focused.log` on this machine.

The safety fix has direct passing lifecycle evidence. Full managed compatibility is not verified by this run. The master thread should rerun the managed integration proof in isolation, investigate any persistent deadline failure, and complete full verification before considering owner activation. No activation, deployment, push, PR or merge was performed.
