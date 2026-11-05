# Experience process recovery

## Cause

On macOS, a repeated process-group `SIGKILL` can return `EPERM` while the group is finishing its exit. The experience guardian treated every signalling error except `ESRCH` as fatal. The failure occurred in the child's `exit` handler, after the timeout had already sent `SIGKILL` successfully. That prevented the `close` handler from joining the group and sending its known timeout receipt.

The parent then joined the group itself, but correctly reported an unknown external outcome because the guardian's receipt was missing. This was a guardian crash, not a missed test deadline or an IPC delivery failure.

The unchanged full suite reproduced the reported failure at 2191 ms. Captured stderr showed `kill EPERM` in `guardian.mjs` from the child's `exit` handler, followed by guardian exit code 1. A 16-process repetition reproduced five failures. Each captured process-table snapshot after the error showed no remaining group members. A first fix that checked the process table once still failed under stress: a member could appear in that snapshot and disappear before the next query.

## Behaviour

The guardian now checks group membership after `EPERM`. An empty group, or a group containing only zombies, needs no further signal. If members remain, it retries signalling at 10 ms intervals for at most one second. A persistent denial still crashes the guardian with an attributable error. This is a bounded cleanup retry, not an extension to the command's timeout.

The guardian sends a receipt only after the child closes and the process-table join finds no live group members. Neither `EPERM` nor a vanished leader alone proves successful termination. Timeout and cancellation retain their known reason after verified cleanup. Normal output and exit status still come from the child.

The parent's fallback join also retries `EPERM` within its existing five-second bound. A lost guardian still produces `NativeProcessFailure`, even when fallback cleanup succeeds. Unverified termination still produces an unjoined failure. Tool-host shutdown and unknown external-effect handling retain their existing rules.

The independent guardian still enforces command deadlines and owner IPC loss. Parent cancellation and deadline kill timers remain unchanged. No protected core or auth code changes.

## Diagnostics

Guardian failures now include exit code, signal and a bounded IPC error code. An uncaught-exception monitor writes only sanitised error-code and syscall tokens. The parent drains stderr, retains at most 1024 characters, and exposes only that structured diagnostic. It does not expose stack traces, commands, arguments, environment values or child output in these failure details. Child output retains its existing receipt bounds.

## Regression evidence

`apps/server/experience-process-recovery.test.ts` is discovered by `npm test`. Its temporary preload exercises the actual guardian and real owned processes. It injects a transient live-group `EPERM` and a post-exit `EPERM` only after checking the real process table. Normal exit, timeout and cancellation must return their exact receipt reason. The same regression against the original guardian exits 1 with `synthetic kill EPERM` instead of returning a receipt.

A second test denies every group signal. It verifies that the guardian exits 1, emits no receipt, identifies `EPERM`, and leaves the live process for explicit test cleanup. The existing descendant and owner-loss tests exercise real group cleanup without injection. An added machine test kills the actual guardian and requires a joined but uncertain failure with `signal=SIGKILL`.

After the complete fix, 32 concurrent repetitions of the unchanged timeout and cancellation test passed with zero failures. The targeted machine, recovery and tool-host run passed all 11 tests, including guardian loss and refusal to claim clean shutdown with a live command.

## Limits

These checks use temporary fixtures and owned children. No live apps, subscription requests, OAuth, owner data, deployment or external services are exercised. Same-user shell access remains an accepted trust boundary. Process-table join excludes zombies, which cannot execute further effects, and does not claim to contain a process that deliberately escapes its group.

## Verification record

The old-code regression log is `/tmp/gaia-process-regression-old.log`. The actual old full-suite crash and stderr are in `/tmp/gaia-process-diagnose.log`. The final stress log is `/tmp/gaia-process-stress-final.log`, and the targeted lifecycle log is `/tmp/gaia-process-green.log`.

The initial diagnostic full run also failed an unrelated protected-core assertion at `core/integration.test.ts:706`: `recovered.failures` was 2 rather than 1 in the hanging sandbox boot recovery case. Core source was not changed. That case passed in the later full runs. This separate observation is not evidence against the experience guardian fix, and is not silently counted as an initial green gate.

`Fix Root Causes` kept the change on the observed signalling race. `Model the Domain` kept lifetime verification separate from knowledge of the external outcome: a joined group with a lost guardian remains uncertain. The task forbids child agents, so investigation and review were performed directly.

Final gates passed before commit: `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npm test`, `npm run build`, `npm run check:protocol`, `git diff --check` and `git diff --cached --check`. The final full test log, `/tmp/gaia-process-verified-test.log`, records 237 tests, 236 passed, zero failed and one existing opt-in skip. Build completed with existing Vite directive, source-map and chunk-size warnings. No manifest or lockfile changed.
