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

The cancellation prerequisite added optional JSON receipt fields, `effectClass` and `dispatched`. Existing receipts without them parse unchanged. Old intents remain unknown unless explicitly classified read-only. No SQL tables, profile document schemas, registry task versions, GOOD manifests, recovery code, auth code or dependencies changed. The existing legacy receipt/restart and managed schema/recovery tests remain in the full suite. Terminal records already written by an older release are not retrospectively reclassified.

The jobs.ts edit is confined to settlement. It does not change onText, activity extraction or projection. The Agent Desktop executable in the tests is an owned Node fixture that writes a scratch file and waits. It proves the host's desktop lease, dispatch, receipt and join paths, not acceptance of a real desktop application. Hosted search uses the actual installed search wrapper and Pi runtime with a controlled provider response, without external network or credentials.

## Evidence

The new top-level `experience-effect-certainty.test.ts` exercises both native tools across timeout, owner Stop, host-only quiesce, server quiesce and shutdown/reopen. Each checks the process PID is gone, the job requires review, the receipt retains output/status, retry gets 409 and the file has one write. Additional cases cover queued desktop cancellation, read-only search Stop and host quiesce, and a provider attempting a fresh tool call after an unknown effect.

The original focused batch passed 20 tests, including guardian-loss joined fallback and existing host integration. The expanded certainty file passed 15 tests without skips. Native tests use the existing owned-process capability probe to skip inside managed candidate sandboxes that forbid signalling. Those skips do not replace the direct unsandboxed lifecycle proofs.

The first full-suite attempt was stopped after nested candidate checks exposed missing sandbox guards in the new fixtures. Its owned temporary processes were cleaned up and the guards added before rerunning verification.

## Shipped founder retry policy

Every terminal attempt that started a potentially effectful action requires explicit acknowledgement before the whole request runs again. Completed, failed, stopped and interrupted jobs keep their actual states. Known completed actions are never relabelled unknown. Uncertain jobs still require `repeatUncertain: true`, with priority over the new guard. `repeatEffects` alone cannot bypass uncertainty.

The native host exposes the final receipt's state, effect class and dispatch bit through a WeakMap keyed by the returned result. The external wrapper stores this small `hostReceipt` summary alongside the single result body. It sets optional `job.public.dispatchedEffect: true` in the same transaction as that receipt. There is no second screenshot or output body for successful calls. Unclassified extensions conservatively set the flag on entry to execute. Trusted host evidence, rather than tool names, argv, model descriptions or output text, determines native dispatch. Pre-dispatch rejection and queued desktop cancellation do not set the flag.

A trusted host dispatch observer also commits the flag before execution can be aborted. This closes the Stop race where Pi can settle an aborted worker before the final result reaches the wrapper. It adds no result body or extra receipt row. The final receipt transaction also marks all ancestors. Parent replay can delegate again, so the parent must require acknowledgement even if only its child started an action. Propagation precedes parent settlement and survives reopen. Stop, child joins, unknown receipts and the further-dispatch barrier keep their existing behaviour.

For a non-uncertain flagged job, ordinary retry returns HTTP 409 with `Confirm repeatEffects before running a started action again.` The client opens this confirmation after Try again:

> Gaia already started an action in this attempt. Trying again runs the whole request again, so that action may happen twice.

Run it again sends `repeatEffects: true`. Cancel closes the card without sending a request. The existing uncertain copy and Repeat action button remain. Retry creates a new worker for the whole request. Gaia does not resume or deduplicate earlier attempts.

## Additive compatibility and rollback

`ExperienceJob.dispatchedEffect` and `ExperienceRetry.repeatEffects` are optional literal `true` fields. Retry remains strict. Old jobs without the flag retain their existing behaviour. The new client sends `repeatEffects` only for flagged, non-uncertain jobs. An old server never emits that flag, so its strict retry schema receives no unsupported field. No SQL change, profile document version bump, task version change, dependency change or protected core change is needed.

Rollback to an older server can strip or ignore the new flag. That loses the repeat guard and restores the earlier retry behaviour. This loss is accepted by the founder policy. No deduplication or resume guarantee is claimed in either direction.

## Verification scope

The focused certainty and repeat tests use actual HTTP, Pi Durable, a faux subscription provider, real owned processes and scratch files. They cover completed append then provider failure, exit 1, completed answers, Stop during a later model turn, read-only failure and Stop, host rejection before spawn, queued desktop cancellation, uncertain priority, legacy parsing and durable child-to-parent propagation. The append/provider failure case proves one write before acknowledgement and exactly two after acknowledged replay. Controller and rendered confirmation tests cover the exact wording, request flags, uncertain priority and Cancel.

The original 22 cancellation/process/desktop proofs are retained. The full managed suite is intentionally left to the coordinating parent to run serially. Focused tests do not replace that proof. Native light/dark acceptance at 320 and 1000 pixels also remains with the parent. No live provider, owner data, OAuth, native application, push, PR or deployment was used.

Final validation for the founder policy passed both typechecks, lint, build, protocol conformance and `git diff --check`. The focused certainty/repeat/host/controller/view batch passed 55 tests. `npm run test:experiences` passed 106 tests. Both test runs had no failures, cancellations or skips. Logs are `/tmp/gaia-founder-focused-final.log`, `/tmp/gaia-founder-experiences-final.log` and `/tmp/gaia-founder-build-final.log`. Build retained the existing bundler warnings about ignored use-client directives, source maps and large chunks.

An earlier focused run was stopped because the parent-propagation fixture observed the durable dispatch flag before its scratch file existed, then blocked cleanup on an unreleased provider gate. The fixture now waits for both evidence points and releases the gate before cleanup. The final runs above include that correction. No full `npm test` or managed integration run was started by this implementation worker.

## Parent review: actual process start

An additional owned-executable regression exposed a false positive: an enabled host attempting a missing executable had marked the job as a started action. Native start observation now waits for the guardian to report an actual process PID. A known `spawn_error` receipt records `dispatched: false`, so ordinary retry remains available. Intent uncertainty after owner or guardian loss remains conservative. Settlement joins the started-evidence write. If that write fails, the process is cancelled and joined and its external result remains unknown. The guardian implementation is unchanged. The new missing-executable regression failed before this correction and passed afterwards, alongside a real-process failure test for the evidence callback.
