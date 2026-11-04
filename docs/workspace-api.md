# Workspace backend API

The backend connects the [workspace domain](workspace-design.md) to the existing local owner API. Home keeps its existing protocol, chat row, messages, profile and credential store. These endpoints add no SQLite tables or schema changes. Area chat projections use `gaia.area-chat` conversation documents inside Pi's existing tables.

The SDK schemas live in `packages/sdk/workspace.ts` and `packages/sdk/areas.ts`. The fetch helpers live in `packages/sdk/workspace-client.ts`. There are no new protocol fields, web components or desktop changes.

## Access and admission

Every workspace and area endpoint uses the server's existing exact host, origin and cross-site checks. Workspace and area reads require the existing connected subscription state. Writes also pass the existing release `allowWrite` check, JSON content-type check and size limit. No new authentication mechanism replaces the existing local owner boundary.

Only `POST /api/v1/workspace/confirm` confirms a setup. No model tool receives confirmation capability. The request must name the exact pending proposal ID and revision. A chat reply such as "yes" has no confirmation effect.

One global slot admits Home or area chat, model changes, compaction, image preparation and workspace writes. Conflicting work returns 409. Shutdown refuses new work with 503, aborts the active operation and waits for it before closing Pi, auth or SQLite. Model changes and image preparation preserve a prior stopped or failed chat run, so retry remains available.

## Workspace endpoints

All paths below start with `/api/v1`.

| Method and path           | JSON request                                            | Response                                                                 |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /workspace`          | None                                                    | 200 `WorkspaceState`                                                     |
| `POST /workspace/propose` | `WorkspaceRequest`                                      | 201 `WorkspaceProposal`                                                  |
| `POST /workspace/confirm` | `{ proposalId: UUID, revision: positive integer }` only | 200 `{ kind: "confirmed" or "already_confirmed", workspace: Workspace }` |

`WorkspaceRequest` is `{ plan, sharedPreferences }`. A single plan is `{ kind: "single", purpose }`. A multi plan is `{ kind: "multi", areas: [{ label, purpose }, ...] }`. There must be 2 to 12 areas. Labels have 1 to 100 characters. Purposes have 1 to 1000 characters. Labels and purposes must each be distinct after trimming and case folding. Up to 20 explicit shared preferences are accepted, each with 1 to 500 characters.

Proposals have a fresh UUID and an increasing revision. Replacing a proposal invalidates the old ID and revision. A stale confirmation returns 409 and creates nothing. Confirmation is transactional and repeatable. Concurrent requests either observe the same confirmed workspace or receive the global busy response and can repeat the exact confirmation. A confirmed workspace cannot be replaced or deleted in this increment.

Single-purpose confirmation changes Home's purpose instructions and creates no areas or area metadata. Multi-area confirmation creates independent ownerless Pi conversations. Each receives only its own purpose and the submitted shared preferences. Neither path reads a profile to infer preferences, copies Home's context, resets Home's entries or changes a skipped profile.

## Area endpoints

Each path starts with `/api/v1/areas/{areaId}`. An area ID is the public UUID from a confirmed multi-area proposal. Unconfirmed and unknown IDs return 409. Malformed UUIDs return 400. Private Pi conversation IDs never appear in responses.

| Method and suffix   | JSON request                       | Response                                                                          |
| ------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| `GET /state`        | None                               | 200 `AreaSnapshot`                                                                |
| `GET /history`      | None                               | 200 protocol `Thread`                                                             |
| `POST /messages`    | Existing `Send` schema             | 202 `AreaSnapshot`, or 200 for an identical request already accepted in this area |
| `POST /retry`       | `{}`                               | 202 `AreaSnapshot`                                                                |
| `POST /stop`        | `{}`                               | 202 `AreaSnapshot`, after cancellation joins                                      |
| `POST /model`       | `{ modelId, thinkingLevel? }` only | 202 `AreaSnapshot`, after durable configuration                                   |
| `POST /compact`     | `{}`                               | 202 `AreaSnapshot`; completion appears in `/state`                                |
| `POST /attachments` | Existing `ImageUpload` schema      | 201 `Attachment`                                                                  |

`AreaSnapshot` is `{ areaId, thread, chat }`. `thread` and `chat` use the existing protocol schemas. The thread's `id: "local"` is unchanged. The outer `areaId` identifies the area. Home remains at the original `/state`, `/events` and command endpoints. Area clients read `/state` for progress. This increment adds no area event stream.

`Send` is `{ requestId: UUID, text, attachments?: UUID[] }`. Text is trimmed and limited to 32000 characters. There must be text or at least one image. Up to four distinct image references are accepted. Image upload accepts PNG, JPEG or WebP through the existing bounded preparation path, up to 10 MB input and 3 MB prepared output. The selected area's model capabilities and image limits apply. Stored images remain downloadable through `/api/v1/attachments/{attachmentId}`. Responses contain attachment metadata, never base64 image bytes.

An accepted area message's initial projection is durable before the API responds. Request IDs are global across Home and all areas. Reuse with another area, text or image list returns 409. The server registers durable area request IDs before accepting further commands, including routed requests. Startup also repairs the request ledger from retained area user messages, so an interrupted cross-database write cannot cause a wrong-thread resend. A duplicate that arrives before initial persistence returns 409 and can be repeated after admission.

Retry targets only the area in the URL. It keeps the retained user projection and adds another assistant attempt. It restores that user's original model, effort and image references. Pi receives another explicit input in the same genuine conversation, with its previous context intact. Retry never resets context or moves to the currently selected Home conversation. A successful model change does not alter the selection stored with the original user request.

Compaction uses Pi's actual `compact`, task receipt and placed summary. It reports `done`, `noop` or `error` through `chat.compaction`. Displayed history stays intact while the genuine Pi context can use the summary. Partial and terminal area projections persist additively. Restart converts an interrupted area run to an explicit error without generating a response.

Stop only cancels the scope named by its endpoint. Home Stop also joins any area work routed by that Home turn. Stopping an unrelated area, or using Home Stop during a directly submitted area operation, returns 409. Area models have empty extension, tool and model-tool lists. Model configuration changes only the selected model and effort.

## Home tools

`propose_workspace` accepts `WorkspaceRequest` and returns the proposal as tool output. It creates no conversations and cannot confirm. It remains available for a single-purpose setup when areas are disabled.

`route_to_area` is available only in Home when areas are enabled. Its strict arguments are `{ areaId, text, imageIndexes? }`. Text is limited to 8000 characters. There must be text or images. `imageIndexes` contains up to four distinct integers from 0 to 3, referring only to images supplied on this Home turn. It accepts no raw images, profile fields, model tools or private conversation IDs.

Only one routed request is allowed per Home turn. Its deadline is two minutes. Routing submits to the confirmed area's genuine conversation and waits for its answer. Successful tool output contains JSON `{ areaId, result }` with the actual area answer. Pi limits retained tool output to 24000 bytes and 1000 lines, with its normal truncation diagnostics. A failed or cancelled area request never returns a made-up answer.

The routed request carries only the supplied text and selected images. It never automatically copies Home history or profile data. Existing area history stays in the target area. Areas cannot route recursively or inherit Home tools. Home cancellation, Pi tool invocation cancellation and timeout explicitly abort and join the ownerless area work. The Home operation remains admitted until that join and area projection writes finish.

## Parent integration and baseline gate

`createPi(path, auth, extensions?, settings?, options?)` adds an optional fifth argument. `options.areasEnabled` defaults to false. Multi-area confirmation and area commands remain disabled until it is true. No environment variable enables it. The managed runtime and native entry point in this branch keep the default.

Before enabling it, the parent must upgrade both the active runtime and the GOOD rollback baseline to use `openRecoveredHarness` before any scheduling, including safe mode. Use the owner-controlled baseline upgrade path. Recovery must work without workspace-aware UI. Prove rollback and safe-mode reopening of captured ownerless work makes zero provider calls, including deferred fetch and cancellation. This branch changes no protected core or live baseline.

After that gate, the parent can pass `{ areasEnabled: true }` from its owned runtime integration. The UI must keep Home at the existing endpoints, render proposals for explicit exact-ID/revision approval, use the explicit area endpoints for area controls and retry, and refresh the relevant area after commands. A single workspace must remain Home without a sidebar. Browser, real owner data and live provider acceptance belong to the parent.

### Shared effort and interruption handling

Home and areas use `pi-conversation.ts` with the shared `effortLevels` and `supportedEffort` policy. The catalogue exposes one stop per provider effort, rejects hidden aliases and defaults unsupported stored levels from medium. The HTTP area regression verifies the installed Sol catalogue, actual provider options and independent settings after reopen.

A failure after submission, including watcher setup, aborts and joins the conversation before releasing admission. Restarted area replies become an explicit retryable error. Interrupted control operations reopen idle, with any interrupted compaction reported separately. A compact operation does not manufacture an unrelated reply retry.

### Initial limits

Area projections are validated on startup. A corrupt projection can fail startup rather than being silently replaced; no automatic document repair is performed. Home and area history currently grow without pagination and persist whole projections during streaming.

The supervisor's deployment drain currently observes Home. A direct area operation may therefore be stopped during an owner-requested update; the child still aborts and joins it before shutdown. It remains visible as stopped rather than resuming automatically.

Recovery is application code, with caller and helper regressions protected by `core/install.ts`: self-change cannot edit or remove `*.test.ts` or `*.test.tsx`. The trusted recipe discovers and runs those tests. This is regression protection, not an OS boundary against hostile code running as the same user.

Request and area IDs are opaque strings and must be reused exactly. Routed inputs currently use the area's user-message role without an additional author marker. Images routed from Home retain the preparation applied by Home's selected model. New models with smaller image limits will need preparation before routing.

## Verification

Tests use the installed Pi Durable 1.5.0 APIs, Pi's faux provider, temporary SQLite files and ephemeral HTTP ports. No real owner data or credentials are used. There are no live provider calls. No listeners start on reserved ports 4317 or 4319.

`npx tsx --test apps/server/workspace*.test.ts apps/server/pi.test.ts` covers atomic, stale and duplicate confirmation, single-purpose setup, Home and profile preservation, no schema changes, real tool routing, area isolation, effort and images, retry across reopen, real compaction, global admission, cancellation, shutdown drain and zero-call restart recovery. The domain test retains the exact 29 synthetic Home entries. SDK tests use the real HTTP endpoints.

The repository gates are `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npm test`, `npm run build`, `npm run check:protocol` and `git diff --check`. The protected rollback and safe-mode probes remain in `npm test`. This synthetic evidence does not enable areas or upgrade the owner's runtime.
