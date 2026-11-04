# Run the Gaia desktop window

Install dependencies with `npm install`. Use the repository's supported Node version from `package.json`.

Start the server and web client in one terminal:

```sh
npm run dev
```

In a second terminal, open the desktop window:

```sh
npm run desktop
```

The default renderer address is `http://127.0.0.1:4317`. To use a managed Gaia instance on another local port:

```sh
GAIA_DESKTOP_URL=http://127.0.0.1:4319 npm run desktop
```

For remote instances, use an HTTPS address. The desktop command compiles `apps/desktop` to `dist/desktop` and launches Electron. It does not start or manage a server. `npm run typecheck:desktop` checks the Electron source without launching it. `npm run build` builds both web and desktop code.

## Window and renderer contract

The macOS window uses `hiddenInset`, native traffic lights and a 52px draggable renderer title bar. Other platforms use a hidden title bar with native overlay controls. The renderer reserves room for those controls. The window has no browser toolbar.

The renderer runs with context isolation, sandboxing, disabled Node integration and normal web security. The preload exposes only `window.gaiaDesktop.platform` and `openAuth(url)`. IPC accepts calls only from the Gaia main frame. Auth URLs must use HTTPS, have no credentials or custom port, and name `auth.openai.com` or `chatgpt.com` exactly.

Auth opens through Electron's `shell.openExternal`. The OS selects the default browser, which uses its normal profile and session. Gaia does not select a browser executable, create profiles or embed OAuth. In web-only use, the client opens a normal tab. A blocked popup leaves an explicit Open browser action.

New windows are denied and HTTPS links open externally. Off-origin renderer navigation is intercepted. Non-web schemes, embedded webviews and renderer permission requests are denied. HTTP is accepted for the configured renderer only on loopback addresses.

This is a desktop shell, not an installer or the full machine-tools milestone. Pairing, server lifecycle, terminal and file access remain outside this slice.

## Managed renderer updates and history

Managed scripts and styles use release-specific URLs, and their relative imports stay within that release. The server retains access to older release assets so a switch between the HTML and script requests cannot mix bundles. The web and desktop renderer read their loaded release from `import.meta.url`, rather than trusting a source-authored HTML tag. A different `Snapshot.runtime.release`, including the first snapshot after a cold load, calls `window.location.reload()` once. This fetches the current HTML and assets. Promotion and rollback both reload without a same-release loop. An unversioned development page reloads on its first managed snapshot. Ordinary development snapshots have no release identity and do not reload. The SDK replaces an errored SSE stream with bounded exponential reconnect delays of one to ten seconds. Ten seconds without a valid snapshot also closes and replaces the stream, covering a proxy that silently retains a dead upstream connection. Opening or replacing the stream fetches `/api/v1/state` with a five-second timeout. Newer SSE data takes priority over an older recovery fetch. Disposal closes the stream, aborts recovery and clears reconnect and heartbeat timers. Command snapshots also reach the observer.

Only the unsent composer draft is stored, under `gaia.unsent-draft.v1` in origin-scoped session storage. OAuth URLs, codes and tokens are never passed to this store. Writes happen as the draft changes and immediately before reload. Completing a send clears only the draft that was sent. A newer draft survives. Storage access and quota failures leave the draft usable in memory. If a nonempty draft cannot be saved, the renderer defers its reload and asks the owner to send or clear it, or enable storage. Repeated snapshots retry saving. A cleared or successfully sent draft permits the pending update. Closing the window with blocked storage cannot preserve an in-memory draft.

Account settings fetch managed status and change history on opening. A plain development server's 404 silently omits this section. Accepted changes offer Revert, which queues the server's reverse patch. Queued is shown as pending checks, never as accepted. Busy and safe states disable changes. Safe mode keeps chat available and offers no reset control. Diff and check receipts are available in each record's disclosure.

History polls every two seconds while changes are pending, including after a revert. It stops at a terminal result or after 150 reads and offers Refresh. Closing settings aborts its requests and cancels timers. Late responses cannot update a closed or superseded view. The SDK validates a partial browser-only view of managed records with Zod. It does not import the filesystem-backed core schema.

The parent integration task owns native visual review and actual promotion and rollback clicks. Unit checks exercise release transitions, draft recovery, unavailable storage, malformed management responses, queued results and polling cleanup. These checks alone do not establish the complete safe self-modification journey.

## Composer controls

The composer has a model picker and a Compact action. Model selection changes the next turn and survives a server restart. Compact summarises older model context while retaining the visible chat history. Short conversations report that no older context needs compaction. While compaction runs, Stop cancels it.
