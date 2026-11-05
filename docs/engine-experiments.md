# Pi engine compatibility experiments

These are bounded experiments on source `6e60bd4`, using actual Pi AI and Pi Durable 1.5.0. They implement no replacement engine. No production runtime, protocol, protected core, auth, dependency declaration, existing test, owner database or GOOD release was changed or read. Fixtures use temporary SQLite files and no credentials, network services, native apps, OAuth or external effects.

## Reproduce

Provision the prepared checkout with `npm ci`, then run:

```sh
npx tsx --test apps/server/engine-compat.test.ts
npx tsx apps/server/testing/engine-experiments.ts
```

The two deterministic recovery tests are also discovered by `npm test`. Timing measurements are opt-in. There is no 50 ms CI assertion.

## H1: missing custom task definitions

Both queued and live cases passed through the unchanged `openRecoveredHarness`.

| Fixture | Older task registry outcome | Abort-only bridge outcome | Recovery provider calls | Replayed custom phases |
| --- | --- | --- | --- | --- |
| Queued parent, unused owned worker | `orphaned`, `missing_task` | `aborted` | 0 | 0 |
| Sleeping parent, streaming owned worker | `orphaned`, `missing_task` | `aborted` | 0 | 0 |

The new registry is `createRegistry()` plus a version 1 `gaia.experiment-background` task. Its conversation-owned parent has `background: true` and `abandonOnRestart: true`, matching the present experience job ownership flags. The parent owns a separate worker conversation. The test reads the persisted owner edge and checks that the parent is pending in the queued case and sleeping in the live case. The live worker has a genuine Pi generation task and an in-flight faux-provider stream. Queued admission does not start a stream. Pi's admission API resumes scheduling, so that fixture deliberately has an unused owned conversation rather than claiming a paused worker submission.

The older registry is exactly `createRegistry()`, including Pi's built-in tasks. This is task-definition-equivalent to Gaia's current root registry, whose Gaia extensions register tools and prompt sections rather than custom tasks. It is not the full `createPi` registry, an actual old checkout boot, a protected owner-upgrade activation, or a read of GOOD data. No worker names a Gaia extension, tool or provider credential. This isolates task-kind compatibility from missing extension and tool compatibility.

For each fixture, the harness closes before the SQLite database is copied into two independent recovery inputs. Both inputs therefore contain the same committed task graph and synthetic evidence document. This is a consistent closed-store capture, not a live file copy or a SIGKILL crash proof. The live parent has actually entered its phase and committed a future sleep. The worker has made one faux-provider call before capture. No OS child process is needed to represent these interrupted Pi states.

The missing-definition case opens successfully and terminates the custom task as orphaned. It does not invoke the new task's abort handler. The explicit bridge registers the same task name, version and checkpoint shape. Its work phase throws if invoked, while its abort handler commits an aborted terminal outcome. That handler runs exactly once. Both variants cancel the worker generation and settle its submission as unanswered. Both leave zero inspected tasks and submissions, with no additional provider call after a further scheduler turn. Provider deferred fetch and cancellation counts remain zero.

A separate JSON document retains an `unsafe-unreconciled` marker and an old-readable synthetic string unchanged. No tool or effect is registered or executed. This checks retention and zero replay, not reconciliation of a real tool receipt. Generic task settlement does not decide whether an external effect succeeded, and orphaning does not supply a Gaia job result or public uncertain state. Future registrations with different versions, nested custom descendants, missing tools and document migrations require their own proofs.

## H2: one store, 16 streaming workers

Each run opens one new temporary SQLite Pi store with 16 separate ownerless worker conversations, real Pi generation scheduling and the production `conversationAdapter`. Each faux response contains 3,840 characters. The provider uses 64-token chunks at 2,048 tokens per second. Pi partial progress interval is explicitly zero. Other progress settings retain their defaults. Three repeats alternate the layout order.

Each worker has an 8,192-character retained field, current partial text and a write counter. The family layout uses 16 keys in a session-scoped `defineDocFamily`. The shared layout keeps the equivalent 16 records in one session-scoped document. Both checkpoint every projection commit. Each callback joins a per-worker promise chain, like the current job projection path. This compares document shapes under identical callbacks. It does not reproduce the whole `ProfileDoc`, Zod parsing, receipts, images, publication listeners or SSE clients.

Latency starts immediately before `harness.commit` and ends when it resolves, including time queued on Pi's mutation line. It excludes waiting on that worker's earlier callback chain. Throughput is projection commits divided by total streaming and projection-drain time. It excludes setup and close, and does not count internal Pi commits. Percentiles use nearest-rank samples. Every run produced 240 measured commits, or 15 callbacks per worker, including repeated or final text callbacks. No deduplication is applied.

Machine context: Apple M4 Pro, 14 logical CPUs, 48 GiB RAM, Darwin 25.6.0, Node v24.21.0, temporary local filesystem, 5 November 2026 UTC. Other machine activity was not controlled. SQLite uses Pi's unmodified defaults.

| Repeat | Layout | p50 ms | p95 ms | Maximum ms | Projection commits/sec |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Family | 0.154 | 0.293 | 9.383 | 466.3 |
| 1 | Shared | 0.450 | 0.729 | 7.020 | 473.7 |
| 2 | Shared | 0.448 | 0.818 | 5.063 | 475.2 |
| 2 | Family | 0.103 | 0.234 | 1.764 | 483.6 |
| 3 | Family | 0.089 | 0.210 | 5.077 | 484.9 |
| 3 | Shared | 0.415 | 0.748 | 5.479 | 473.7 |

All runs reached 16 concurrently started streams before any worker finished. All runs had a maximum of one outstanding measured projection commit. Node's synchronous SQLite work and callback timing serialised these writes without a sustained application commit backlog. This is an overlapping-stream workload, not a 16-writer saturation result. Both shapes were below the proposed 50 ms p95 threshold here. The threshold, representative payload size and acceptable homelab load remain founder decisions. The small throughput difference is not evidence for an engine rewrite.

Every run asserts final text and positive write counts for all workers, 16 provider calls, zero active streams, zero pending projection commits, zero live Pi tasks and zero submissions. Watches close through the production adapter, then each harness closes and the temporary directory is removed. The command exits normally without forced termination. No child processes or external effects are created.

## Receipt and image source findings, not optional performance measurements

The existing image upload store is a separate session document, `gaia.experience-images`, defined in `apps/server/experiences/images.ts`. Uploaded image base64 is not directly a field of `ProfileDoc`. The upload path appends base64 and checkpoints that image document.

Tool results are different. `trackedExtension` in `apps/server/experiences/external.ts` stores `JSON.stringify(result)` in each job receipt inside `ProfileDoc`. A tool result containing image base64 can therefore enlarge the profile document. Each tracked tool has one profile commit for invocation intent and one for its returned receipt. Each text callback also mutates the profile document. This is source evidence of a possible hot-document cost, not a measured byte-amplification result. The benchmark's 8 KiB retained field is synthetic and does not quantify real screenshot receipts.

`createProfile.mutate` publishes after every profile mutation. Actual cross-scope SSE reads, event counts, bytes and client fanout were not measured. Those optional measurements are deferred to avoid extending H1 and H2 into an acceptance rewrite.

## Decisions and limits

The experiments support an explicit distinction between safe scheduler settlement and useful Gaia job recovery. An older registry can settle an unknown task without provider replay, but the custom task's abort logic does not run. An abort-only bridge produces a predictable aborted outcome when the stored version and phase match. The founder must decide whether that bridge belongs in a future compatible root registry and how Gaia projects uncertain public job results after rollback. This experiment installs no bridge in production.

Document families reduce median commit cost in this fixture. They do not prove that all profiles should share one store, that the current independent-job core should be replaced, or that protocol v2 is needed. Decide those separately after choosing representative retained-history, receipt and SSE workloads and testing on the intended host. Existing schema, owner data and GOOD compatibility remain requirements.

## Recorded benchmark output

The following is the complete final measured run. Earlier exploratory runs corrected an invalid progress option before this recorded command passed typechecking.

```jsonl
{"context":{"date":"2026-11-05T02:10:25.304Z","node":"v24.21.0","platform":"darwin","release":"25.6.0","cpu":"Apple M4 Pro","logicalCpus":14,"memoryGiB":48,"pi":"1.5.0","workers":16,"responseCharacters":3840,"retainedBytesPerWorker":8192,"tokensPerSecond":2048,"tokenSize":64,"checkpointEveryCommit":true,"partialIntervalMs":0}}
{"repeat":1,"layout":"family","workers":16,"callbacks":240,"commits":240,"seconds":0.5147426250000001,"commitsPerSecond":466.2524305229239,"p50Ms":0.15362500000003365,"p95Ms":0.29341599999997925,"maxMs":9.382791999999995,"peakPending":1,"peakStreams":16,"peakLiveTasksAtCompletion":15,"liveTasksAtEnd":0,"pendingAtEnd":0,"sqliteBytes":425984}
{"repeat":1,"layout":"shared","workers":16,"callbacks":240,"commits":240,"seconds":0.5066428750000002,"commitsPerSecond":473.70645447249194,"p50Ms":0.4496249999999691,"p95Ms":0.7293750000001182,"maxMs":7.0195830000000115,"peakPending":1,"peakStreams":16,"peakLiveTasksAtCompletion":15,"liveTasksAtEnd":0,"pendingAtEnd":0,"sqliteBytes":376832}
{"repeat":2,"layout":"shared","workers":16,"callbacks":240,"commits":240,"seconds":0.5050135829999999,"commitsPerSecond":475.2347423494945,"p50Ms":0.44754200000011224,"p95Ms":0.8178330000000642,"maxMs":5.0629579999999805,"peakPending":1,"peakStreams":16,"peakLiveTasksAtCompletion":15,"liveTasksAtEnd":0,"pendingAtEnd":0,"sqliteBytes":376832}
{"repeat":2,"layout":"family","workers":16,"callbacks":240,"commits":240,"seconds":0.4962853749999997,"commitsPerSecond":483.5927312990034,"p50Ms":0.10316700000021228,"p95Ms":0.23366699999996854,"maxMs":1.763582999999926,"peakPending":1,"peakStreams":16,"peakLiveTasksAtCompletion":15,"liveTasksAtEnd":0,"pendingAtEnd":0,"sqliteBytes":425984}
{"repeat":3,"layout":"family","workers":16,"callbacks":240,"commits":240,"seconds":0.49497525,"commitsPerSecond":484.8727284849091,"p50Ms":0.08887499999991633,"p95Ms":0.20974999999998545,"maxMs":5.077333000000181,"peakPending":1,"peakStreams":16,"peakLiveTasksAtCompletion":15,"liveTasksAtEnd":0,"pendingAtEnd":0,"sqliteBytes":425984}
{"repeat":3,"layout":"shared","workers":16,"callbacks":240,"commits":240,"seconds":0.5066660839999999,"commitsPerSecond":473.68475526378444,"p50Ms":0.41520900000023175,"p95Ms":0.7480839999998352,"maxMs":5.478500000000167,"peakPending":1,"peakStreams":16,"peakLiveTasksAtCompletion":15,"liveTasksAtEnd":0,"pendingAtEnd":0,"sqliteBytes":376832}

```

## Verification and handback status

The final experiment files passed `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npm run build`, `npm run check:protocol`, `git diff --check` and `git diff --cached --check`. The focused `npx tsx --test apps/server/engine-compat.test.ts` passed both tests. The benchmark completed all six runs with normal exit status zero. The build retained the existing Vite large-chunk warning.

A full `npm test` run on the corrected files completed with 255 tests: 242 passed, 10 failed, 2 cancelled and 1 skipped. The first managed promotion failure reported `Self-change is disabled in safe mode. Review the failures locally.` The managed integration parent reached its 600-second timeout, with later cases cancelled. Both experiment tests passed in this run. An earlier run had captured an already-corrected experiment type annotation error and is not the final typecheck evidence.

Several full suites and builds overlapped on the machine. This includes an overlapping run started here while correcting the annotation, so the failed managed integration result cannot establish a production regression or a clean baseline. A retry was already running when the parent requested no further full retries. No further full suite is to be started by this worker. The parent will run managed integration and the combined suite serially before landing or activation. No deadlines or protected code were changed.

The original commit condition requires every gate to pass. Until the parent supplies a passing serial full-suite result or explicitly revises that condition, this worker leaves the three experiment files staged without an implementation commit. No push, PR, merge, deployment or architecture selection is part of this handback.

The already-running retry has now exited with status 1 after 503.2 seconds: 255 tests, 249 passed, 5 failed, none cancelled and 1 skipped. Both experiment tests passed again. The first promotion rolled back with `Health probe deadline exceeded` rather than being accepted. Other reported failures were the stable-receipt expectation, safe-mode staging and a refused fixture connection. This worker's retry ran without a second local suite, but other workers' machine load was not controlled. It is not a serial machine-wide acceptance proof. No further retry was started after the parent's coordination message.

Full logs retained for the parent on this machine:

- `/tmp/gaia-engine-final-3.log`: corrected-files concurrent suite, 242 passed, 10 failed, 2 cancelled, 1 skipped.
- `/tmp/gaia-engine-isolated-tests.log`: already-running retry, 249 passed, 5 failed, 1 skipped.
- `/tmp/gaia-engine-final-0.log` through `/tmp/gaia-engine-final-5.log`: individual gate outputs.
- `/tmp/gaia-engine-benchmark.jsonl`: recorded benchmark output, also embedded above.

## Parent integration verification

The parent combined these experiments with the reviewed owner-context, cancellation, quiet-progress, receipt and text-projection changes. A machine-wide serial run completed with 286 passing tests, zero failures or cancellations, and one existing opt-in provisioning skip. Both typechecks, lint, build, protocol conformance and diff checks also passed. Evidence is retained in the parent verification directory under `founder-combined-*`. This verifies the combined source, not owner activation or a replacement architecture.
