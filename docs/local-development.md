# Local chat seed

This is a partial M0/M1 slice. It runs one local conversation through Pi Durable and Sol 6.1. It does not implement the supervisor, pairing, self-modification, tools, onboarding or production hosting.

## Run

Use Node v24.21.0 and npm 11.19.0.

```sh
npm install
npm run dev
```

Open http://127.0.0.1:4317. The headless API listens at http://127.0.0.1:4318. Both expose `/healthz` through the Vite proxy. `npm start` runs the API alone. `npm run build` checks TypeScript and builds the web client into `dist/web`; the API does not serve that directory yet.

Configuration:

| Variable        | Default                   | Purpose                                                 |
| --------------- | ------------------------- | ------------------------------------------------------- |
| `GAIA_HOST`     | `127.0.0.1`               | API bind address                                        |
| `GAIA_PORT`     | `4318`                    | API port                                                |
| `GAIA_WEB_PORT` | `4317`                    | Vite port                                               |
| `GAIA_DATA_DIR` | `./data`                  | All persistent runtime state                            |
| `GAIA_ORIGINS`  | Local API and web origins | Comma-separated exact allowed origins and request hosts |

Ports 8096, 8264 and 8090 are rejected for the API. Keep this seed on loopback. Pairing and authenticated remote access are not implemented. Forwarded headers are ignored. Vite binds to loopback. External proxy hosting needs a later implementation and review.

## ChatGPT connection

The server registers only Pi's `openai-codex` provider and `gpt-6.1-sol`. All model calls use Pi Durable. There are no tools or shell extensions registered.

An existing canonical OAuth credential for `openai-codex` in `~/.pi/agent/auth.json` is copied once into app-local storage. Other provider credentials and API keys are ignored. Global credential files are never changed. The separate Codex credential format is not read or translated.

Otherwise click **Connect ChatGPT**, then **Open sign-in**. Pi's built-in browser OAuth flow listens temporarily on localhost:1455. Complete it in the browser, or use the sign-in reply field if Pi requests a manual callback. Keep the Gaia page open. A failed sign-in returns to the connect state. **Reconnect ChatGPT** remains available when configured credentials expire or become invalid. Connected means credentials are configured, not that a live request has succeeded.

Credentials live in `data/gaia.sqlite`, alongside the UI conversation. Pi's durable transcript lives in `data/pi.sqlite`. SQLite may create companion WAL files in that directory. The executable sets a private umask, directory permissions 0700 and database permissions 0600. Do not publish or commit the data directory. Back up the whole directory while the server is stopped. Only one Gaia process may own a data directory.

## Protocol and behaviour

`packages/protocol/index.ts` defines the schemas. `packages/sdk/index.ts` is the browser SDK. Routes use `/api/v1`:

- `GET /state`: current thread and connection metadata.
- `GET /events`: server-sent `snapshot` events, including streamed partial replies. Reconnect gets the full saved thread. A one-second heartbeat also refreshes sign-in state.
- `POST /messages`: `{requestId: UUID, text: string}`. Text is trimmed and limited to 32000 characters. Repeated accepted request IDs do not create duplicate UI turns.
- `POST /stop`: `{}`. Cancels the current Pi conversation run and retains partial output.
- `POST /retry`: `{}`. Requests another answer to the last user message. Earlier attempts remain visible. Pi receives a fresh input containing the repeated text, so retries also remain in its model context.
- `POST /auth/connect`: `{}`. Starts Pi's built-in OAuth flow.
- `POST /auth/reply`: `{value: string}`. Supplies Pi's requested sign-in reply.

Writes require `application/json`. Network inputs are schema-validated. Exact Origin and Host checks reject cross-origin writes and DNS rebinding requests; browser cross-site requests are rejected. No permissive CORS headers are sent. Public errors omit raw provider errors and credentials. The server does not log prompts or provider errors.

Messages and partial text persist before publication. One run is allowed at a time. A restart retains messages and marks an unfinished UI run as interrupted. On opening Pi storage, the seed aborts outstanding work rather than intentionally resuming a chargeable request. Pi can begin recovery as storage opens, so this is not an exactly-once billing guarantee. Retry is explicit. The two databases are not one atomic transaction, so a hard crash between their writes can leave a UI attempt and Pi transcript out of sync.

## Interface source

The free Board UI Button, Input and Textarea and their dependencies were installed from the official registry with CLI 0.5.9, then copied into `apps/web`. The included `BOARDUI-LICENSE` is the upstream MIT licence. No Pro components are used. Sources: https://www.boardui.com/r/button.json, https://www.boardui.com/r/input.json, https://www.boardui.com/r/textarea.json and https://github.com/BoardUI/boardui.

The page uses semantic colour tokens in `apps/web/styles/theme.css` and Board UI typography utilities. The system font is intentional. There is no theme picker yet. The installed registry source contains upstream comments and type assertions. No assistant-ui or Radix dependency remains.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm ls --all
```

The tests use real HTTP sockets and SQLite. The Pi adapter tests run the real durable harness with Pi's clearly labelled deterministic test provider, including streaming, cancellation and context recovery. The executable cannot select that provider. CI requires no subscription credentials. These tests do not prove a live Sol response or a usable browser layout. The parent owns browser and sign-in verification.

`npm audit` currently reports moderate development-tool findings through ESLint's minimatch dependencies. The production dependency audit is separate. Do not apply npm's suggested forced downgrade to ESLint 4.
