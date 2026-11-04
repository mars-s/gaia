# Isolated experience profiles

This is the implementation contract for the owner-requested increment in spec v1.4. Behaviour described here is a target until the acceptance report records a passing observation.

## Problem and caller experience

The existing owner chat has one global work slot. Four layouts cannot provide concurrent work by changing navigation alone. The new runtime adds isolated profiles alongside the existing chat. A profile has a UUID and a declarative layout, so product names stay in test cases rather than the scheduler.

The client lists profiles, proposes a plan, displays its exact configuration and explicitly confirms its revision. Confirmation creates real conversation scopes. A message returns a durable admission before its model finishes. The composer remains available while earlier jobs run. Each result stays associated with its originating message and scope.

```ts
const proposal = await client.create({ requestId, plan });
await client.confirm(proposal.id, { revision: proposal.revision });
const accepted = await client.send(profileId, scopeId, { requestId, text });
await client.stop(profileId, accepted.jobId);
```

`packages/protocol/experiences.ts` defines the shared wire shapes. Pi conversation and task IDs stay private. Every response carrying scope data includes the profile identity. Draft keys include both profile and scope UUIDs.

## Design decision

Use design A, independent jobs for incoming requests, with the shared UI boundary from design B. One foreground orchestrator that queues every new request behind its current tool cannot satisfy the user's central-chat example. Each job gets a selected context snapshot, its own Pi conversation and a tracked owner. Results update the originating feed and its context ledger. They never impersonate a new owner instruction.

Adopt design C's explicit task ownership, joined cancellation, desktop resource lease and generation quiescence. A Pi background controller is conversation-owned, and its worker conversation is task-owned. An unsafe external action is never automatically replayed after restart. Interrupted work remains visible and can be explicitly retried as a new attempt. The existing abort-before-provider recovery policy remains intact.

Foundational Thinking determines the common schemas before implementation. Separate Before Serializing Shared State gives each profile a separate Pi store and each job its own execution context. Prove It Works requires real provider, process and native acceptance beyond fixtures.

The scope context ledger is authoritative for later messages and compaction. Admission records its input, payload digest, context revision and job ownership atomically. Final settlement records its result and a deduplicated context contribution atomically. The ledger explicitly labels pending work and result provenance. A job uses the context that was available when admitted. It does not silently import a sibling's future result or another scope's history. A real context retrieval tool can select older relevant entries.

## Context rules

| Layout | Identity | Conversation and memory |
| --- | --- | --- |
| `single` | One assistant | One visible conversation and shared explicit memory. |
| `bots` | One identity per Bot, plus Home | Separate role, thread and memory per Bot. Home transfers selected context explicitly. |
| `channels` | One assistant | Separate channel threads and one shared memory namespace with provenance. |
| `sessions` | One assistant | Independent session history, memory and model selection. New session preserves earlier sessions. |

Memory is a real versioned fact store behind a small tool interface. It does not mean loading every transcript into every prompt. Concurrent updates use revisions or append-only records. No memory is inferred from the owner's existing chat. New profiles start empty.

## Additive HTTP contract

All routes use the existing loopback Host and Origin checks, connection checks and write gates. Mutations parse strict schemas. IDs are UUIDs. Unknown profile, scope or job returns 404. Changed payload with a reused request ID returns 409. A closed admission gate returns 503. No unauthenticated shell HTTP route is added.

| Route under `/api/v1/experiences` | Result |
| --- | --- |
| `GET /` | `ExperienceIndex`. |
| `POST /` | Strict `ExperienceCreate`, returns proposed `Experience` with 201. |
| `GET /:profile/state` | `ExperienceState`. |
| `POST /:profile/confirm` | Strict `ExperienceConfirm`, returns ready `ExperienceState`. Only this owner action applies a proposal. |
| `POST /:profile/scopes` | `ScopePlan`, returns `ExperienceScope` with 201. Refused for a single-chat profile. |
| `GET /:profile/scopes/:scope/state` | `ExperienceScopeState`. |
| `GET /:profile/scopes/:scope/events` | SSE full scope snapshots with increasing revision. Disconnect does not stop jobs. |
| `POST /:profile/scopes/:scope/messages` | `ExperienceSend`, returns `ExperienceAdmission` with 202 after persistence. |
| `POST /:profile/scopes/:scope/model` | Existing `ModelSelection`, returns scoped state. Applies to future admissions. |
| `POST /:profile/scopes/:scope/compact` | Empty body, runs genuine Pi compaction for that scope's context ledger. |
| `POST /:profile/scopes/:scope/attachments` | Existing `ImageUpload`, returns scoped `Attachment`. |
| `GET /:profile/scopes/:scope/attachments/:attachment` | Validated stored image bytes, with `nosniff`. |
| `POST /:profile/jobs/:job/stop` | Empty body, returns terminal `ExperienceJob` only after descendants settle. |
| `POST /:profile/jobs/:job/retry` | `ExperienceRetry`, returns a new admission and retains the old attempt. |

The SDK owns all URLs, parsing, friendly errors and subscriptions. One headless controller owns selected profile, scope, drafts, admissions and subscriptions. The UI renders intent through that controller and does not implement another polling loop. Common transcript, composer, account and managed-history components remain shared.

Model-assisted setup uses a real Pi tool to propose an `ExperiencePlan`. It may research product references with `search_web`. That tool proposes only. It cannot call the confirmation route or claim confirmation from typed agreement. The four named test cases supply setup prompts and acceptance assertions, not hardcoded execution branches.

## Actual tools and progress

An app-owned Pi extension supplies `search_web`, Mac shell and Agent Desktop. Every action includes a short model-generated activity description. Real invocation and settlement drive the small avatar and text row from the supplied reference. Keep only current activity in the transcript. Preserve terminal receipts separately. Never substitute cycling labels, fake progress, raw tool names or raw commands.

`search_web` calls `ToolExecutionApi.models.completeSimple()` with the existing `openai-codex` model and subscription auth. Supported `onPayload` and `onProviderStreamEvent` hooks declare hosted search and retain actual search events and URL citations. A successful answer without a completed search call is a failed search. No dependency patch, alternate provider or API key is required by this design. Live subscription support must still be proven.

Mac commands use per-invocation working directories, a sanitised environment, deadlines, bounded output and an owner-loss guardian. Cancellation joins the process group and descendants. Desktop input uses one shared lease because the Mac has one cursor and keyboard. Independent model and CLI work can continue. The renderer stays sandboxed. Probe and safe-mode instances have no machine capability. Full same-user shell access remains the documented owner-level trust boundary.

## Storage and managed lifecycle

Store each profile under the active conversation generation at `experiences/<profile UUID>`. One Pi store per profile owns its index, scopes, context, memory and job documents. Admission and settlement must not span independent databases. Reuse the host's auth capability, without copying credentials.

The legacy owner chat, skipped profile, workspace and attachments remain untouched. The runtime joins every job and store before shutdown. A whole-runtime admission barrier is required before a managed snapshot, because Home's idle flag says nothing about profile jobs. Parent integration owns the smallest checked protected launcher, schema and quiescence changes. The supervisor's auth, rollback and safe-mode policies remain unchanged.

Nested profile databases need recursive compatibility coverage before managed activation. Active and GOOD baselines must understand the new profile data before enabling it. New profile execution is unavailable in safe mode, while legacy Home chat remains usable. No candidate check or probation probe may dispatch a Mac action.

## Verification and reconciliation

The baseline is commit `2ab6d06`, with 35 owner messages and skipped setup. The baseline suite passed 167 tests with one opt-in proof skipped. Typecheck and lint passed before the spec increment was committed.

Implementation work is split into shared runtime, actual tools and shared client, followed by four parallel scenario workers. Each worker receives bounded paths and the same schemas. Tests use temporary stores, real Pi with deterministic providers, owned local form and webhook fixtures, and real process cancellation. Real subscription search, native interactions and the protected owner upgrade are separate acceptance observations.

The acceptance manifest and decision log are under `data/verification/four-profiles`. Pending or inconclusive checks stay pending. Each implementation change reconciles any contract deviation here before its callers are integrated.
