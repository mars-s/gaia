# Claude plan sign-in

## Investigation, before implementation

The lockfile installs `@earendil-works/pi-ai` 1.5.0. Its published npm README documents provider factories and programmatic OAuth through `models.login(providerId, "oauth", interaction)`. The installed package does not include a README, so the published README was inspected with `npm view @earendil-works/pi-ai@1.5.0 readme`.

The installed `dist/providers/anthropic.js` exports `anthropicProvider()` with provider ID `anthropic`. Its OAuth resolver loads `dist/auth/oauth/anthropic.js`, named `Anthropic (Claude Pro/Max)` and marked `isSubscription: true`.

Pi supports browser login and copy-code login. Browser login emits an `auth_url` at `https://claude.ai/oauth/authorize`, uses PKCE, and starts a loopback callback at port 53692, falling back to a free port. It also accepts a pasted code or final redirect URL. Copy-code login uses `https://platform.claude.com/oauth/code/callback` and prompts for `code#state`. Both exchange the code through Pi at `https://platform.claude.com/v1/oauth/token`.

Pi refreshes expired OAuth credentials during auth resolution with its OAuth `refresh` implementation and writes rotated credentials through the supplied credential store. `models.logout("anthropic")` deletes only that provider's stored credential. Gaia must not implement token exchange or refresh itself.

The provider supplies the real catalogue through `dist/providers/anthropic.models.js` and `dist/providers/data/anthropic.json`, including names, image input and thinking capabilities. Gaia should use these values directly. Pi's Anthropic factory also exposes API-key auth, but Gaia will register only its OAuth method and will keep ambient environment and file-based auth disabled.

## Implementation plan

Keep the existing ChatGPT command body and connection states valid. Add optional provider metadata and per-plan connection flags to protocol v1. Add a provider argument to connect and a provider-specific disconnect command. Retain ChatGPT's existing model default; select Claude Opus 5.5 when Claude is the only connected plan, with explicit ordered model preferences if it is absent. Show only connected providers in the catalogue and route each selected model through its owning Pi provider.

The work uses temporary databases and `initialise(false)`. It does not read the owner's Pi credentials or touch the owner runtime.

## Protocol v1 additions

`POST /api/v1/auth/connect` still accepts `{}` for ChatGPT. It also accepts `{ "provider": "openai-codex" | "anthropic" }`. `POST /api/v1/auth/disconnect` requires that provider field and disconnects only the selected plan. Both return the existing snapshot response. The SDK exports `connectPlan` and `disconnectPlan`.

Connection snapshots optionally include `plans`, an array of `{ provider, connected }`. Connecting snapshots optionally identify `provider`. The connected `model` string can now identify Claude as well as the existing GPT default. Catalogue rows optionally identify their provider. The existing v1 routes, snapshot envelope, ChatGPT names and request bodies remain valid. Updated clients are required to understand Claude model IDs. Conformance checks cover both provider values, the legacy empty connect body and invalid inputs.

Only one interactive login runs at a time. Both stored plans can be connected together. Disconnect waits for idle chat and refuses an in-progress login. Expired credentials remain listed as connected until Pi resolves them; refresh failures require Reconnect, as with the existing ChatGPT flow. Gaia does not revoke the upstream account grant on local disconnect.

## Isolated authorisation check

On 6 November 2026, an isolated loopback HTTP server on an ephemeral port, 55701, started Claude login through the actual auth endpoint. It used a temporary database and `initialise(false)`, with model traffic disabled. Pi emitted `https://claude.ai/oauth/authorize`, PKCE S256, redirect `http://localhost:53692/callback`, and the prompt `Complete login in your browser, or paste the authorization code / redirect URL here:`. The database mode was `0600`, and the credential count stayed zero. The login was cancelled, the callback server closed and the temporary directory removed. No real account login or token exchange was attempted. This proves Pi's real authorisation start, not completed account access or a live Claude model response.

To finish, the owner selects Continue with Claude, or Connect beside Claude plan in Settings, signs in to the Claude Pro/Max account in the browser and approves Pi's consent screen. On the same machine the loopback callback completes sign-in. With a browser on another machine, copy the final redirect URL or authorisation code into Gaia's visible sign-in reply field and select Continue. Then choose a Claude model from the model picker. ChatGPT can remain connected throughout.

## Merge notes

This branch owns plan sign-in only. The welcome change adds one component beside the existing ChatGPT button, without changing its action or accessible name. Settings replaces the single hard-coded plan row with `PlanAccounts`. Expect conflicts in `apps/web/app.tsx`, `apps/web/welcome.test.ts` and `apps/web/settings-page.test.ts` when merging the design round. Preserve its layout and place the Claude action beside ChatGPT, keeping the provider-aware sign-in copy and expanded Claude code prompt. The added `apps/web/plan-sign-in.tsx` holds the small shared rendering pieces.

The exact `claude.ai` host is added to Electron's HTTPS sign-in allowlist. No other desktop behaviour changes. Auth and the model availability helper remain in protected core and must be integrated through the owner-reviewed core upgrade process. No push, merge, deployment or owner runtime changes are part of this task.


## Provider capability boundaries

Model availability is supplied explicitly by auth to each adapter and setup runtime. A missing availability source offers no models. The source reads connected provider IDs once per catalogue read, rather than querying SQLite for every model.

Hosted web search currently uses Pi's Codex-specific implementation. Claude models are not offered `search_web`; their prompt explains that hosted search is unavailable and that the owner can choose a ChatGPT model to use it. Gaia does not call the unsupported search path or claim that Claude searched the web. Native Claude hosted search remains unimplemented.

The existing automatic Pi credential import remains ChatGPT-only. Claude always uses its explicit Connect action. Tests and this task use `initialise(false)` and never inspect the owner's import file. Login errors deliberately use Gaia's own plain messages and do not log Pi's token-endpoint exception text.
