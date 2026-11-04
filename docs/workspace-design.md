# Workspace domain and restart recovery

The domain modules implement workspace proposals, atomic confirmation and isolated Pi conversations through the installed Pi Durable 1.5.0 subscription backend. The adapter and HTTP integration now use these modules. See [Workspace backend API](workspace-api.md) for endpoint contracts, Home tools, the default-disabled area gate and parent integration steps. There are no new protocol fields or UI changes.

## Contracts

`packages/sdk/workspace.ts` defines Zod schemas and schema-derived public types. It has no private Pi IDs.

- `WorkspaceRequest` contains a `plan` and explicitly approved `sharedPreferences`. A single plan has a purpose. A multi plan has 2 to 12 areas, each with a label and purpose.
- Labels have 1 to 100 characters. Purposes have 1 to 1000 characters. Labels and purposes must each be distinct after trimming and case folding. There can be up to 20 shared preferences, each with 1 to 500 characters.
- `WorkspaceProposal` contains a UUID `proposalId`, positive integer `revision`, proposed `workspace` and shared preferences. Each proposed area receives an opaque, branded UUID `areaId`.
- `WorkspaceConfirmation` contains exactly `proposalId` and `revision`.
- `WorkspaceState` is `empty`, `proposed` or `confirmed`. Both non-empty variants contain a proposal. A single workspace has no area or sidebar metadata.

`openWorkspace({ harness, home }, context)` requires the existing reserved Home conversation from the caller. It does not create Home, inspect a profile, reset onboarding, load a baseline or resume scheduling. Its methods are:

| Method                                     | Result                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `read(context)`                            | Public `WorkspaceState`.                                                                                                                   |
| `propose(request, context)`                | A fresh proposal ID and the next revision. Replaces a pending proposal. Rejects after confirmation. Creates no conversations.              |
| `confirm(confirmation, settings, context)` | `{ kind: "confirmed", workspace }`, `{ kind: "already_confirmed", workspace }` or `{ kind: "stale" }`.                                     |
| `resolveArea(areaId, context)`             | Server-only Pi `Conversation`, restricted to a confirmed area's exact public ID. Throws for unconfirmed, unknown or missing conversations. |
| `configureArea(areaId, settings, context)` | Changes only that confirmed area's model and thinking level through `Conversation.configure`.                                              |

`WorkspaceSettings` contains Pi's `ModelRef` and `ModelThinkingLevel`. The caller supplies a model available through its existing subscription model catalogue and validates supported effort choices. These methods configure Pi state without making a provider call. They do not replace the normal model catalogue or authentication layer.

Confirmation is an owner action. A future model tool may propose a workspace, but must not receive `confirm`. Transport authentication and explicit owner confirmation belong to the integrating caller.

## One transaction owns confirmation

One session-scoped `defineDoc` stores `gaia.workspace` version 1 in Pi's existing document tables. Its private state binds Home and maps public area IDs to Pi conversation IDs. Storage decoding validates numeric private IDs and reference membership. Pi's `idFromNumber` constructor is internal to the package and is not imported through an unsupported path.

Inside one `harness.commit`, confirmation reads the document and checks the exact proposal ID and revision before creating anything. A matching consumed proposal returns the existing workspace. A stale confirmation creates nothing. Concurrent duplicate confirmations serialize on Pi's commit line.

For multi-area confirmation, each area uses `tx.createConversation({ ownership: { kind: "ownerless" } })` followed by Pi's exported `configure(tx, id, change)`. All private references and the consumed proposal commit with those conversations. A callback failure rolls back every conversation, its Pi documents, configuration and references.

Pi table reads must precede table writes. Confirmation performs no table reads after the first creation. Document access, including `configure` on a new conversation, is permitted after table writes. Creation hooks supplied by the caller must respect those same Pi rules and keep their effects inside the transaction.

Single-purpose confirmation configures the existing Home model, effort and purpose instructions. It creates no area conversations. Multi-area confirmation leaves Home's configuration and all its entries unchanged. Neither path copies, resets, forks or compacts Home's entries.

Confirmed scope changes and workspace deletion are deliberately absent. Adding those later requires an explicit owner-reviewed lifecycle, including what happens to existing area histories and pending work.

## Context and capability isolation

All conversations share one Harness and one SQLite file. Separate Harness instances would prevent a single atomic confirmation transaction. Forking Home would inherit its private history, so areas use independent ownerless conversations with no entries.

Each area receives only its own purpose and the explicitly supplied shared preferences. The instruction text identifies the JSON values as owner data, not authority to change permissions. No owner profile or old Home conversation is read for this data. The workspace can be configured while owner-profile setup remains skipped.

Area configuration explicitly sets `extensions: []`, `tools: []` and `modelTools: []`. It cannot inherit Home's profile-writing, self-change or routing tools through the registry's default selection. `configureArea` changes only model and effort. It preserves these restrictions and the area's purpose. Prompt wording alone is not a security boundary; the empty capability lists enforce the tool restriction.

`resolveArea` returns a private handle for server integration. The bounded Home `route_to_area` tool uses that lookup after owner confirmation. It explicitly awaits cancellation for the selected area, since Home abort does not reach independent ownerless conversations. Areas have no routing tool, so there is no delegation loop. Selected-area images, effort, compaction and submissions use the returned conversation's normal Pi APIs.

## Recovery before any scheduler resume

`openRecoveredHarness(storage, options, context)` is the startup entry point for a writable Harness. It returns `{ harness, interrupted }`. `interrupted.tasks` contains private `taskId` and `conversationId` pairs. `interrupted.submissions` contains private submission and conversation IDs and any `requestId`. The caller uses this report to mark existing UI projections stopped or interrupted. This is server-only data, not an SDK response.

The helper opens Pi with an empty model catalogue. It inspects the paused scheduler and collects every live task, including background work and work in ownerless areas. It withdraws every queued submission, including queued writes, then commits abort marks for every live task while scheduling remains paused. Only then does it resume and explicitly await every task's terminal receipt. It checks that no live tasks or unsettled submissions remain before enabling the supplied model catalogue.

Pi's `waitForIdle` excludes background work, so it is insufficient for this cleanup. `Conversation.abort`, `submit`, transaction-form `submit`, `compact`, submission waits and task waits resume scheduling. None may run before all interrupted work has been marked. `Harness.abortTask` and `abortSubmission` do not resume scheduling.

Pi's generation abort handler can call `models.cancelDeferred` for a persisted deferred response. The empty catalogue prevents even that provider cancellation call during recovery. The helper enables the original models only after cancellation settles. The deferred provider job can therefore remain on the provider's side; this module cannot stop an external job while also guaranteeing zero provider calls. No deferred fetch or new generation runs locally.

Keep the registry used at startup limited to trusted tasks whose abort handlers perform local cleanup. Arbitrary extension abort code could perform its own network calls outside Pi's model APIs. This helper cannot control such code. If recovery fails, it closes the Harness and does not return a usable runtime. The caller must not admit user actions concurrently with opening and recovery.

### Required baseline upgrade before enabling areas

The adapter now calls `openRecoveredHarness` before obtaining Home or admitting any work. It no longer calls `root.abort` on startup. That older startup sequence resumes the entire Harness before cancelling only Home's ownership scope. It can restart ownerless area work and make provider requests.

The integration owner must install generic recovery in both the active runtime and the GOOD rollback baseline before enabling area creation. Safe-mode startup must also use it, even when it has no workspace integration or sidebar. Recovery does not depend on workspace mappings and can cancel all Pi work in an older UI. Upgrading only the active adapter leaves rollback and safe mode unsafe for area data. Use the owner-controlled baseline upgrade path. These modules do not modify protected core, rollback, auth or safe mode.

## Verification

The tests use real Pi Durable with temporary Node SQLite files and Pi's faux provider. All text and identifiers are synthetic. No live model, credential or owner data is accessed.

Workspace tests cover exact and stale confirmation, concurrent duplicate confirmation, an injected failure in the second conversation's public `conversationCreated` transaction hook, Home's 29 unchanged entries, area context and tool isolation, independent model and effort settings, reopening references and unchanged SQLite schema definitions. Single-purpose confirmation keeps one conversation.

Recovery tests close real live runs across Home and two ownerless areas, leave queued input and write submissions plus a sleeping background task, then reopen and cancel everything. They assert unchanged provider generation counts until the next explicit user action. A deferred-response case separately proves zero deferred fetch and cancellation calls on restart.

Run the focused tests with `npx tsx --test apps/server/workspace*.test.ts apps/server/pi.test.ts`. Repository typecheck, desktop typecheck, lint, all tests, build, protocol conformance and `git diff --check` remain the integration gates. The backend tests now include HTTP, routing and SDK integration. UI, baseline upgrades and live runtime acceptance remain with the parent owner.
