# Frontend workspace increment

This increment keeps Pi and the server's persisted conversation projections authoritative. `app.tsx` owns the account, profile and shell. `composer.tsx` owns the input view. `conversation-controller.ts` owns scope-bound drafts, uploads, admission and model queues. `workspace-controller.ts` owns workspace reads and cancellable area polling.

The **Model the Domain** principle led to an explicit Home or area scope and a registry keyed by that scope. **Type System Discipline** keeps area IDs branded and responses schema-validated through the SDK. **Sequence Work into Verifiable Units** separated transcript rendering from workspace integration. **Test Behavior, Not Implementation** guided delayed-response, retained-byte and exact-request tests.

## Transcript and libraries

The transcript uses the public `@assistant-ui/core/react` exports `useExternalStoreRuntime`, `AssistantRuntimeProvider`, `ThreadPrimitiveMessages` and `MessagePrimitiveParts`. The installed public declarations and a server-render test verify this integration. The [official external-store guide](https://www.assistant-ui.com/docs/runtimes/custom/external-store) explains the ownership model. Its examples import the larger React package; this client uses the independently published core React entry point.

The external-store adapter is read-only. Sending, retry, Stop, model choice, uploads and compaction stay with Gaia's controller and SDK. No assistant-ui cloud adapter, local model runtime, client tool handler or history adapter is installed in the runtime. The mandatory transitive `assistant-cloud` package is installed by core, but Gaia does not invoke it. The production bundle contains no `assistant-cloud`, cloud endpoint, telemetry or `sendBeacon` strings in the checked build.

Assistant text uses react-markdown and GFM. User text remains literal. Raw HTML is skipped, links allow safe web, mail and relative destinations, and Markdown images render as text. Owned attachments retain Gaia's validated attachment URLs, previews and fallback. There is no automatic remote Markdown image request.

Exact additions are:

| Package               | Pin      | Licence    | Use                                                  |
| --------------------- | -------- | ---------- | ---------------------------------------------------- |
| `@assistant-ui/core`  | `0.3.32` | MIT        | External-store runtime and unstyled React transcript |
| `@assistant-ui/store` | `0.3.22` | MIT        | Required peer                                        |
| `@assistant-ui/tap`   | `0.9.24` | MIT        | Required peer                                        |
| `react-markdown`      | `10.1.0` | MIT        | Safe Markdown rendering                              |
| `remark-gfm`          | `4.0.1`  | MIT        | Tables, lists and GFM                                |
| `fake-indexeddb`      | `6.2.7`  | Apache-2.0 | Development-only IndexedDB tests                     |

Compared with the `6f7c3fd` lockfile, 105 package entries were added: 102 MIT, one ISC, one BSD-3-Clause and one Apache-2.0. Each added installed package has a licence file. Their full notices ship at `/THIRD-PARTY-NOTICES.txt`, sourced from `apps/web/public/THIRD-PARTY-NOTICES.txt`. No existing resolved package version changed, including Pi AI, Pi Durable and Electron. No Radix package, `@assistant-ui/react`, optional AI SDK, Redis or OpenTelemetry peer was installed. The worktree's own `node_modules` was created with `npm ci --ignore-scripts` before installation.

`npm audit` reports 11 moderate findings in the inherited development ESLint/minimatch chain. The production-only audit reports zero findings. These are registry audit results, not a security certification. Dependency upgrades belong in a separate checked change; this increment does not run `npm audit fix` or change existing pins.

## Bundle measurement

Both measurements use `npm run build`, the same lockfile resolutions for existing dependencies, and Node `gzipSync` defaults on the emitted assets. Values are bytes. The baseline was built at `6f7c3fd` before adding dependencies. The final row is measured from this increment's production build.

| Asset      | Baseline raw | Final raw | Baseline gzip | Final gzip |
| ---------- | -----------: | --------: | ------------: | ---------: |
| JavaScript |       646139 |   1095362 |        207127 |     340307 |
| CSS        |       110957 |    113366 |         19064 |      19526 |

The added runtime and Markdown renderer increase the JavaScript bundle. Vite still reports its chunk-size warning. The separately served licence notices add 136940 bytes and are not fetched by the app. These measurements do not establish native startup time or memory use.

To repeat the asset measurement after building:

```sh
node --input-type=module - <<'JS'
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
for (const name of readdirSync('dist/web/assets')) {
  const bytes = readFileSync(`dist/web/assets/${name}`);
  console.log(name, bytes.length, gzipSync(bytes).length);
}
JS
```

## Request contracts and admission

All reads use the existing schema-validating SDK. Home retains `/api/v1/events`, `/state` and the original command endpoints. Areas never fall back to Home's thread or chat settings. `AreaSnapshot.areaId` must also match the requested area. The area `/state` snapshot already includes complete displayed history, so the frontend does not duplicate it with a `/history` fetch.

| Operation                    | Contract                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Workspace read               | `GET /api/v1/workspace`, on connection and after completed Home turns, including turns completed between snapshots |
| Confirmation                 | `POST /api/v1/workspace/confirm`, exactly `{ proposalId, revision }` from the displayed proposal                   |
| Area progress and history    | `GET /api/v1/areas/{areaId}/state`, validated `AreaSnapshot`                                                       |
| Area send                    | `POST .../messages`, existing strict `Send`: `{ requestId, text, attachments? }`                                   |
| Area retry, Stop and compact | `POST .../retry`, `.../stop`, `.../compact`, each `{}`                                                             |
| Area model                   | `POST .../model`, strict `{ modelId, thinkingLevel? }`                                                             |
| Area image                   | `POST .../attachments`, existing `ImageUpload`: `{ id, name, mimeType, data }`                                     |

Only the explicit Confirm setup button calls confirmation. A typed yes is an ordinary Home message. A rejected or replaced proposal refreshes workspace state and leaves chat and drafts intact. Single confirmation stays in Home. Only confirmed multi shows the compact Home and area navigation, with horizontal overflow at narrow widths.

One controller admits local mutations across all scopes. Known Home or area work also blocks new sends and settings. Initial confirmed-area discovery attempts finish before chat writes are available. An unreadable area disables its own writes while Home and healthy areas remain usable. A cached running status from an unreadable area does not hold the other conversations indefinitely. The server remains authoritative and can return 409 if that area is actually still working; the client retains the draft and request identity. Reconnection refreshes cached running areas even while Home is selected.

Home SSE can remain idle during direct area work. Known active areas therefore continue polling while Home is selected. If Home is running, Stop uses Home's endpoint to join routed work. A directly running area otherwise uses that area's endpoint. Busy work in another scope offers navigation, without a Stop button for the wrong conversation.

Selected idle areas poll every five seconds. Running areas poll every second until terminal, even after leaving them. Reconnecting selected or active areas retry every three seconds. A serial background discovery pass checks other idle areas, with 15 seconds between completed passes. Each SDK read has a 15-second timeout. Idle unselected areas have no fast timer. Leaving an idle area aborts its read; disconnect and lifecycle cleanup abort all polling and discovery. Every area command fences earlier polls, accepts only its own snapshot, and triggers a fresh read. Request identity and cancellation checks prevent late responses from publishing.

## Draft storage and release reload

Each visited conversation owns one draft session and model queue outside the mounted Composer. Home keeps the existing metadata key `local`. Areas use `area:{areaId}`. New image records use `{scopeKey}:{imageId}`. Metadata version 3 stores references, so text edits do not rewrite bytes. Saving a draft removes unused image rows from that scope in the same transaction. Another scope's bytes are preserved, including reused image UUIDs. Existing version 2 Home references and the older inline draft format remain readable. Migration retains request UUIDs and bytes, and does not delete original legacy image records. Legacy session-storage Home text clears only after a durable save.

Send and upload completion capture the originating scope and draft request ID. A successful older send cannot clear a newer edit or another conversation. Failed uploads and failed or ambiguous sends retain the original request and images. Accepted user IDs in subsequent snapshots can reconcile an ambiguous send.

The release barrier checks every visited session, including unmounted scopes. It waits for saves, file reads, IME composition, model queues and local mutations. Switching views never disposes a queued model choice. The latest choice commits to the scope where it was made before sends or reload can resume.

Metadata version 3 is a frontend compatibility boundary. An older renderer that only understands version 2 cannot read the new metadata, although it remains stored. The parent must include this reader in any frontend rollback release, or add a compatible reader before relying on older frontend rollback. No records are deleted to work around that limitation.

## Checks and parent acceptance

Required checks for each implementation commit are `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npm test`, `npm run build`, `npm run check:protocol` and `git diff --check`. The final test count and commit hashes are returned in the handoff. The Impeccable detector returned no deterministic findings. That is not visual acceptance.

Tests exercise actual SDK fetch contracts with synthetic responses, the real assistant-ui runtime through server rendering, and IndexedDB behaviour through fake-indexeddb. They cover exact confirmation, stale proposal replacement, single and multi navigation, global admission, direct and routed Stop ownership, selected model capabilities, scoped uploads and retries, delayed send completion, retained UUIDs and bytes, unmounted reload barriers, latest queued model selection, poll cancellation and stale-response rejection. Existing source tests for owner interview progress, drafts and model queues remain in the suite. The width-aware Textarea implementation is unchanged.

The parent owns these remaining integration steps:

1. Install the exact dependency additions with `npm ci` in the destination checkout. Keep the existing runtime pins unless separately authorised to upgrade them.
2. Complete the owner-controlled active and GOOD baseline recovery upgrade described in `docs/workspace-api.md`. Prove generic ownerless recovery before scheduling, including safe mode and rollback, with zero provider calls on reopening interrupted work.
3. Only after that gate, enable the backend with `{ areasEnabled: true }`. This frontend changes no runtime options, server, auth, protected core or live baseline.
4. Include the version 3 draft reader in frontend rollback targets. Review the increased production bundle and separately address inherited development audit findings.
5. Verify real Pi/provider turns, routed Stop, native focus and Escape, the selected model row, Skip's transparent appearance, Markdown, pending proposal replacement and draft survival in both themes at 320px. This task launched no browser, native app or development server and accessed no real owner data or credentials.

## Changed files

- Transcript: `apps/web/transcript.tsx`, `transcript.test.ts`, `profile-panel.tsx`, `style.css`.
- Scope and input: `apps/web/app.tsx`, `composer.tsx`, `composer-controls.tsx`, `conversation-controller.ts`, `workspace-controller.ts`, `workspace-panel.tsx`, `chat-draft.ts`.
- Focused tests and fixtures: `apps/web/conversation-controller.test.ts`, `workspace-controller.test.ts`, `workspace-panel.test.ts`, `draft-storage.test.ts`, `conversation-fixtures.ts`.
- Dependencies and notices: `package.json`, `package-lock.json`, `apps/web/public/THIRD-PARTY-NOTICES.txt`.
- Handoff: `docs/frontend-workspaces.md`.

No SDK, server, core, self-modification, desktop, governance, spec, agent instructions or owner data files changed.
