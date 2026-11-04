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

This is a desktop shell, not an installer or the full machine-tools milestone. Pairing, server lifecycle, terminal and file access remain outside this slice. Default-browser routing has unit and source verification only until the parent completes a real sign-in click.
