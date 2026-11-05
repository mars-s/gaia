# Experience runtime handover

Implementation commit: `004605bbf35d6d25dea9df5e782a800d6749f763` on `t3/implement-experience-runtime`, based on `de293bf`. The backend is opt-in through `createPi(..., { experiencesEnabled: true })`. Default startup, probes and safe mode gain no experience or machine capability. Parent integration owns enabling the option, protected launcher changes, recursive schema compatibility, the active and GOOD baseline upgrade, and real-provider/native acceptance.

## Contracts for integration

`ChatAdapter.experiences` is the typed `ExperienceRuntime` capability. Its `index`, `create`, `resolve`, `busy`, `quiesce` and `close` methods are implemented. `createChatServer` also exposes `busy()` and `quiesce()`. Quiesce closes HTTP admission and profile admission, stops and joins complete job subtrees, then joins configuration, image preparation and compaction operations. It does not return a clean acknowledgement until those operations settle. Parent code must apply a deadline and refuse a snapshot when joining fails or times out. Quiesce is irreversible for this instance; reopen a runtime to admit work again. Quiesce drains the stores while keeping them readable. The parent must call `close()` to close all Pi stores before copying a generation; a drain alone is not a closed-store snapshot acknowledgement.

The optional `experiences` options carry `extensions`, `env`, `capabilities`, `concurrency` and compaction `settings`. Extensions use the installed Pi 1.5.0 APIs, including `ToolExecutionApi.details` and the invocation context's `abortSignal`. This accepts the machine worker's extension without importing its modules. Supply `self_change` explicitly when that instance is authorised to have it. The legacy `extensions` argument remains scoped to the legacy harness. All profile harnesses share `auth.models` directly; no credential file is copied.

`extensionsForJob(binding)` supplies extensions bound to the admitted profile, scope, job and actual Pi worker conversation. The runtime installs them before submitting model work, explicitly selects only the common and that worker's extensions, and removes the bound extensions after the worker and its descendants settle. External tools retain durable invocation tracking. This avoids a mutable current-job identity and duplicate tool definitions leaking between concurrent workers. `capabilities` may also be a callback. Profile and index reads evaluate it afresh, so managed probation and later gate changes do not leave stale capability claims.

All routes in `docs/experience-profiles.md` are implemented under `/api/v1/experiences`, after the existing Host, Origin, cross-site and write gates. All reads require an existing connection too. The HTTP mutations use the frozen strict protocol schemas. SSE emits full `ExperienceScopeState` values with strictly increasing runtime revisions and does not own the jobs' lifetimes. Image reads return validated bytes with `nosniff` and a restrictive CSP. The proposal request UUID also identifies its profile, making crash recovery and proposal replay deterministic without a separate cross-database index.

No wire schema changed. One type-only integration change outside the listed files is required: `ConversationAdapter` in `pi-workspace.ts` omits the new optional runtime capability before applying `Required`. Otherwise TypeScript incorrectly requires every individual conversation adapter to contain an entire experience runtime. Workspace behaviour is unchanged. Parent review must accept this scope exception.

`propose_experience` is a real Pi tool in the legacy setup harness when experiences are enabled. It persists a proposal using an invocation memo as the request key. It cannot confirm the plan. Confirmation requires the exact owner-supplied revision, and scopes are created atomically only then.

## Durable ownership and scheduling

Each UUID directory under `generation/experiences` contains one Pi SQLite store. The profile document owns proposals, scopes, jobs, request digests, the passive context ledger, explicit versioned facts and tool receipts. A separate session document in the same database owns image bytes and scope references. Directory creation is idempotent and parent directories are fsynced. Directory enumeration is the index, so a crash cannot publish an index entry pointing at an independently committed database.

Admission atomically records the request digest, frozen model and effort, selected context and memory revisions, feed IDs, pending context contribution, conversation-owned background anchor and task-owned worker conversation. A worker runs through a registered Pi task, with no detached promise used as a job. Terminal settlement commits the result, answer text, passive context contribution and anchor outcome together. A replay returns the existing job; a changed message or scope with the same request ID conflicts.

The default scheduler allows four active jobs at each of four bounded depths, with a global waiting limit of 256 and at most 64 live jobs per profile. A parent may create at most eight children, through depth three. Separate capacity by depth prevents parents waiting for their children from consuming those children's reserved capacity. This bounds active workers to sixteen by default. Setting `concurrency: 1` still permits one worker at each depth. These are explicit reserved descendant slots, rather than a promise of one total provider request.

The subordinate tools spawn actual jobs and support read, wait and joined Stop. A child anchor stays in its parent task's Pi conversation, as Pi requires, while the worker configuration, selected context, images and public results belong to its explicitly selected destination scope. This also supports Home delegating to another Bot without changing task ownership. They cannot control an unrelated job. Parents join children even when the model forgets to wait. Stopping a parent closes further child admission and joins descendants. Cancellation wins over a late successful answer once Stop has been persisted.

Tool progress is projected from authoritative active Pi LiveDoc slots and model-supplied `details.description`, with stable job/call IDs. Settled and recovered jobs have no active rows. Supplied external tools are wrapped with `replay: unsafe`, a durable invocation record before execution and a receipt after execution. Unreceipted invocations remain uncertain. Citation arrays supplied in receipt `details.citations` or `structuredOutput.citations` are validated and returned with completed jobs.

The existing `openRecoveredHarness` abort-before-provider recovery is retained. It cancels pending work before exposing the real models, rather than resuming an unsafe tool or retrying an interrupted model call. An interrupted job remains visible. A job with an unreceipted invocation is `uncertain`. Retry creates a new job attempt, retains the old attempt and requires `repeatUncertain: true` for uncertain work.

## Context and memory

The passive scope ledger records admitted inputs and exactly-once terminal results with job provenance. Each worker sees only its admission-time selection. Later sibling results cannot change that selection. `retrieve_context` searches actual older ledger entries and can explicitly select another scope in the same profile. It never searches another profile. Current-scope retrieval stops at the job's selected revision.

Memory stores explicit append-only facts with revision, source scope, source job and timestamp. Writes require an expected namespace revision. Single and channels layouts share a namespace. Bots and sessions use separate scope namespaces. Shared facts do not carry the originating channel's transcript. No old owner conversation or workspace data is loaded into these profiles.

Scoped model and effort changes affect future admissions. Compaction runs Pi's actual summariser against the passive ledger conversation and stores the resulting active Pi model context as the next admission's base. Original ledger entries remain retrievable. Compaction requires the selected scope to have no live jobs and briefly closes message admission for that scope, while other scopes keep running.

## Fixture and evidence

`apps/server/testing/experiences.ts` exposes a temporary root server and endpoint, faux provider, proposal/confirmation helpers, scope and profile reads, admission and settlement helpers, reopen, connection/write toggles and held-tool gates. It uses real Pi 1.5.0 and temporary SQLite, without credentials. Later profile workers can import it directly.

The top-level runtime tests cover independent held jobs plus a third completed answer, replay conflicts, exact confirmation, legacy preservation, subordinate capacity and joined Stop, all four memory namespaces, scoped image ownership, Host/Origin/write/connection policy, genuine compaction, frozen queued settings, SSE activity and disconnected-client lifetime, model-assisted proposal, quiesce, and two real child-process SIGKILL boundaries. The crash cases kill during a scratch-file effect and after terminal commit. Reopening makes zero provider requests, preserves the scratch effect once and retains one terminal ledger contribution.

Real subscription responses, hosted search support, local Mac command guardians, Agent Desktop input/lease handling, browser/native UI, protected-generation promotion and recursive compatibility are parent acceptance work. This backend does not supply those tools or claim those checks passed. Tool extensions must honour invocation cancellation and join their actual effects. A non-cooperative extension can prevent quiesce; that must cause parent integration to reject a clean-snapshot claim.

## Working decisions

Model the Domain led to one durable profile document and an explicit job state machine, with admission and settlement in the same Pi store. Type System Discipline kept the public capability and internal IDs typed, without changing the frozen protocol. Architecture exploration was sequential because this implementation brief forbids children; the supplied research selected independent jobs over a single foreground queue. The implementation stays split into admission, job execution, images, tools, capacity, persistence and lifecycle modules. No child agent, push, deployment, live desktop operation or protected-core edit was performed.

## Verification record

Before the implementation commit, these checks passed against the committed source:

- `npm run typecheck`
- `npm run typecheck:desktop`
- `npm run lint`
- `npm test`: 184 tests, 183 passed, one existing opt-in dependency-provisioning proof skipped, zero failures or cancellations.
- `npm run build`: passed, with the existing Vite directive, source-map and bundle-size warnings.
- `npm run check:protocol`: passed.
- `git diff --cached --check`: passed.

The sixteen new runtime tests include the cross-Bot saturated-parent case. The crash tests also passed directly inside the unchanged candidate sandbox. They request self-SIGKILL over the fixture's owned IPC channel because the sandbox denies a parent's process-signalling syscall. The fixture exits on IPC loss and has its own deadline. This adds no candidate machine capability.

An earlier full run failed while the crash fixture used forbidden parent signalling. A subsequent typecheck caught nullable child stdio after adding IPC. Both fixture issues were corrected before the passing full run above. The backend's recovery policy and protected sandbox were not relaxed. Source modules, tests and this handover are the only deliverables; parent integration and acceptance remain pending.

The same complete check list was rerun before committing this handover. All checks passed again, including the full suite with 183 passes, one existing opt-in skip and zero failures or cancellations.
