# Owner onboarding

Setup is an optional conversation. A new empty chat offers Start setup and Skip. Existing conversations keep their history and can start setup from Account.

Gaia asks one missing question at a time about name, purpose, life areas, initiative and approval preferences. `record_owner_answers` retains explicit answers and corrections as an unconfirmed draft. Several answers in one message are accepted. Collected fields are supplied to Pi on every setup turn, so name and initiative are not repeatedly requested. The model can propose these details for review. It cannot confirm them. Save confirms the exact proposal shown in the app. Continue editing retains collected details. Skip stops an active reply, joins its cancellation and leaves ordinary chat available.

Account shows the confirmed profile. Reset or forget profile asks for confirmation before clearing it. This retains conversation history. Details already present in the conversation and Pi history are not erased. Replacing a saved profile currently requires resetting it and starting setup again.

This is the first part of M3. Separate agents, memory scopes, agent routing and machine tools are not implemented.

## Storage and model context

`owner-profile.json` lives beside the server's `gaia.sqlite`, with mode `0600`. In managed mode this is inside the active `GAIA_DATA_DIR/generations/<generation>` directory. The supervisor copies it with the rest of that generation. The probe server has its own separate directory.

Writes use a temporary file, a file flush and an atomic rename. Invalid or oversized files report an error and are not silently overwritten. Ordinary chat can continue without profile context while the profile is unreadable. An operator must investigate a corrupt file before recovery.

The profile uses no new SQLite tables or schema changes. The existing protocol and protected core remain unchanged.

The server supplies a per-turn owner capability to the Pi adapter. A dynamic Pi prompt section includes confirmed profile details before each model request. It reads the file again after process restart and is independent of conversation compaction. `record_owner_answers` and `propose_owner_profile` are narrow tools available only during an active interview. Cancelled or completed turns cannot record answers or write another proposal.

Interview JSON adds optional `answers` and `startedAt`. Older `{kind: "interview"}` files remain valid. Confirmed profiles add optional `approvalPreferences`, so old ready and proposed profiles remain valid. New and skipped profiles are never automatically restarted or inferred from conversation text. No existing messages are rewritten. An initial inline question hides as soon as the owner answers. Later questions belong to the model's conversation, with only a quiet Skip setup control below it.

## Local API

All routes use the existing Host, Origin, authentication and write guards. Profile actions require an idle conversation, except Skip, which cancels and joins active work first. Changing releases can temporarily return `503`, as for other writes.

| Method and path                | Body or result                                                      |
| ------------------------------ | ------------------------------------------------------------------- |
| `GET /api/v1/profile`          | Validated owner state                                               |
| `POST /api/v1/profile/start`   | `{}`, starts from new or skipped                                    |
| `POST /api/v1/profile/edit`    | `{}`, returns a proposal to the interview                           |
| `POST /api/v1/profile/confirm` | `{proposalId}`, confirms only the currently displayed proposal UUID |
| `POST /api/v1/profile/skip`    | `{}`, leaves setup without a confirmed profile                      |
| `POST /api/v1/profile/reset`   | `{}`, removes the profile only                                      |

Successful actions return the existing chat snapshot. Read the profile endpoint for the resulting owner state. The SDK schema defines `new`, `interview`, `proposed`, `ready` and `skipped`. The proposed variant has a unique proposal ID. A stale confirmation returns `409`.

The client refreshes the profile after chat work and profile actions. Requests have a five-second deadline, cancel on disposal and ignore stale responses. A failed load exposes Retry profile while keeping the chat available. Setup actions do not send or clear the composer's draft.

## Verification

`apps/server/profile.test.ts` covers the profile lifecycle, bounds, file permissions, schema preservation, HTTP guards, stale confirmation, retained history, corrupt profile handling, cancelled capabilities and real Pi tool execution through a deterministic provider. It also checks confirmed model context after reopening Pi. `apps/web/profile-reader.test.ts` checks stale reads, cancellation, bounds and retry.

Run the repository typechecks, lint, tests, build and protocol conformance before committing. These automated checks do not establish native usability or subscription-provider behaviour. Parent acceptance must promote the editable source through the managed pipeline, exercise setup in the Electron window, verify a real Sol reply with confirmed context and restart the actual managed service.
