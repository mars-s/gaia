# Run the local managed backend

This backend is the safe self-change slice for macOS. Desktop, onboarding presentation, browser sign-in and live account verification belong to the parent integration task. This does not by itself complete M2.

Install Node 24.21 or newer, then run these commands from the checkout.

```sh
npm ci
GAIA_DATA_DIR="$HOME/Library/Application Support/Gaia/local" npm run start:managed
```

The default URL is `http://127.0.0.1:4319`. `GAIA_PORT` changes the port. Ports 8096, 8264 and 8090 are refused. `GAIA_HOST` accepts loopback addresses in this local slice. Remote access needs pairing and proxy work first.

The first start copies the app into `GAIA_DATA_DIR/repo`, creates a local git baseline, runs the fixed checks and imports a release. It never uses the development checkout as the runtime edit target. Dependency installation may take disk space on first start. No fixed RAM cap applies. The root `node_modules` directory must exist before this import.

The protected installation is under `GAIA_DATA_DIR/protected`, outside `repo`, `staging` and `releases`. It includes auth, supervisor, recovery, probes, schema checks and the fixed verification recipe. Subsequent starts reuse this installation. They do not overwrite it from a changed development checkout. An operator must deliberately create a new installation to update protected code.

All installed state is under one data directory. `control/manifest.json` atomically pairs the code SHA and conversation generation. `credentials/oauth.sqlite` is independent of conversation generations. `staging`, `releases` and `snapshots` retain proposals, code and data for review. The supervisor Unix socket is owner-only through the enclosing directory permissions.

If the data directory contains the seed's `gaia.sqlite` and `pi.sqlite` on its first managed start, import reads consistent SQLite copies. The credential table moves into the separate credential store and is removed from the conversation copy. Existing credentials in the protected store take priority. No credentials are imported from `~/.pi` in managed mode. Stop the seed before using its data directory for a managed import. Use a new data directory to coexist with it.

## Backend contracts

All public routes validate the exact loopback Host and Origin, and reject cross-site requests. The existing `/api/v1/auth/connect`, `/api/v1/auth/reply`, `/api/v1/messages`, `/api/v1/retry`, `/api/v1/stop`, `/api/v1/state` and `/api/v1/events` remain available. API version is 1.

`GET /healthz` returns `ok`, `release`, `mode`, `schema` and `provider`. Managed responses include `X-Gaia-Release`. State and SSE snapshots add an optional `runtime` object with `release`, `mode` and `selfModification`. Clients should reconnect EventSource on disconnect and reload their UI when the release changes. The parent owns that client integration.

`GET /api/v1/onboarding` returns `{version:1,kind:"connect"|"ready",connection}`. `connection` uses the existing disconnected, connecting and connected union. The connect action continues an active login. It does not cancel and restart it.

Self-change routes use JSON bodies and return structured results.

| Method and path               | Request or result                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/selfmod/status`  | Version, deployment state, paired `active`, pinned `good`, failures, busy, selfModification            |
| `GET /api/v1/selfmod/history` | `{version:1,changes:[...]}` with reason, diff, checks, outcome and diagnostic detail                   |
| `POST /api/v1/selfmod/stage`  | `{reason,edits:[{path,text}]}`. Complete source text. Returns staged change with UUID and diff         |
| `POST /api/v1/selfmod/submit` | `{id}`. Returns queued change. It is not a deployment success                                          |
| `POST /api/v1/selfmod/revert` | `{id}` of an accepted change. Stages and queues its exact reverse patch, including added-file deletion |

Allowed source paths are `apps/web`, `apps/server` and `packages/sdk`. Auth, server entry point, tests, core, dependencies, protocol schema, package scripts and build/check configuration are protected. Hidden path segments, traversal, backslashes and symlinks are refused. This deliberately narrow slice does not expose arbitrary shell or filesystem tools. A generated file can be added. Deletion is currently supported by exact revert rather than general stage edits. Revert conflicts are rejected for a fresh proposal.

Outcomes are `staged`, `queued`, `checking`, `accepted`, `rejected`, `rolled-back` and `interrupted`. Use `busy:false` before submitting another change. Safe mode refuses stage, submit and revert. Ordinary POSTs during switching and probation return HTTP 503 with `Retry-After` and a retry message. A failed control command is reported as an error, never an accepted promotion.

The pinned Pi extension exposes only `self_change`. Its `command` argument is a JSON string using `kind` with `read`, `stage`, `submit`, `status`, `history` or `revert`. Source reads use `{kind:"read",path:"apps/web/main.tsx"}`. Submit queues the operation. Promotion gates new writes and waits up to two minutes for the current model reply to finish before stopping it. A timed-out turn rejects the deployment. Interactive production uses the real Pi `openai-codex/gpt-6.1-sol` adapter. No arbitrary terminal tool is registered.

## Transaction and recovery

The supervisor serialises staging, promotions and reversions. It records a journal before stopping the old child. The child and its SQLite handles close before a snapshot. The candidate gets a new data generation. The supervisor then atomically names the new release and generation and boots on the same public port.

Health, a scripted public chat turn and a newly established public SSE stream must all pass. Chat runs in its own database and Pi conversation, outside the user's transcript. If ChatGPT is disconnected, the chat probe fails and the change rolls back. It is never counted as passed or silently skipped. Deterministic providers are available only with explicit test/probe process arguments and are labelled in health.

Normal messages stay gated until probes and the schema compatibility check finish. The schema check compares SQLite `user_version` and every stored definition for the conversation databases. Schema changes have no migration contract in this slice and fail promotion.

Failure restores the complete previous code and data pair before writes reopen. Credentials remain in their separate database, including refreshed tokens. Three consecutive failed promotions, interrupted transactions, or child crashes pin the original known-good code with the current compatible conversation generation. Self-change tools are absent in this safe child. There is no public safe-mode reset endpoint. An operator must investigate failures and explicitly repair local control state.

On supervisor restart, checking, switching and probing states recover conservatively to the previous stable pair. The recorded managed child is killed only after its process command matches this data directory's marker. Startup then launches from the recovered manifest. The child also watches its supervisor IPC disconnect. A lock rejects two supervisors for one directory.

## Fixed checks and sandbox

Candidate package scripts are never invoked. The installed recipe directly calls pinned TypeScript, ESLint, Node test runner and Vite dependencies. Config and baseline tests are protected by hashes. The recipe also runs the installed protocol conformance command and a full candidate server boot. Checks and boot run under macOS `sandbox-exec` with a sanitised environment and temporary databases, without OAuth credentials.

The policy file lives in protected scratch outside candidate writes. Candidates can write only `.scratch`, `.probe-data` and `dist`. Source and trusted recipes are read-only inside the sandbox. The sandbox denies outside data reads and writes and external network access. It permits local network probes and the system and dependency reads Node needs. Unsupported platforms fail closed. Linux sandbox support is not implemented.

This is API enforcement and a verified candidate-check sandbox. Running promoted source as the same macOS user is not a strong OS boundary. Promoted code can bypass filesystem conventions. The dependency store and protected installation are owned by that same user. Auth logic is pinned, but the real model adapter necessarily receives its credential-backed models capability. Do not treat this as isolation from malicious accepted source or a hostile local user.

## Verification commands

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run check:protocol
```

The process integration suite uses temporary data directories and ephemeral ports. It imports and boots the actual app under the OS sandbox, promotes actual server source, checks observable HTTP behaviour, reverts new files and byte-exact source, forces failed checks and runtime probes, checks message retention and the separate credential database, kills the supervisor during probation, and kills actual children into safe mode. The safety suite exercises a policy-overwrite attempt across sandbox launches, read-only source, nested secret exclusion, never-listened server disposal and split Unicode SSE. Browser reconnection, visible UI, live OAuth refresh and real Sol-authored UI edits still require the parent's live review.
