# Implementation handover

Checkout: `/Users/avi/.t3/worktrees/gaia/t3-03567aa3`.

All implementation changes are uncommitted. No parent files, tracked governance files, README, SPEC or hosting docs changed. No PR, push or deployment. Copy only the files listed below. Do not copy `data`, `node_modules` or `dist`.

The local dev process is running at http://127.0.0.1:4317 with API http://127.0.0.1:4318. It uses this checkout's excluded `data` directory. Stop that process before another checkout uses these ports.

## Result

One plain Board UI chat, validated protocol and SDK, Pi Durable SQLite adapter pinned to Sol 6.1, separate app-owned OAuth store, persisted messages, streamed partials, stop, retry, safe error text and reconnect. Board UI free source replaces the originally requested assistant-ui following explicit user steering. Upstream MIT licence is included. There are no Radix or assistant-ui packages in the lockfile.

Model the Domain shaped the discriminated connection/run schemas. Type System Discipline shaped Zod validation at the network boundary and schema-derived client/server types. The implementation stayed with one owner, no delegation, to respect the bounded brief. Browser verification belongs to the parent.

## Verification actually run

- `npm install`: passed with Node 24.21.0 and npm 11.19.0.
- `npm run dev`: both services started and printed their addresses.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: eight tests passed, including actual HTTP, raw socket Unicode and malformed URL regressions, SQLite restart persistence, SSE, cancellation, retries, error redaction and credential-write serialisation. Pi tests use the real durable harness with Pi's labelled test provider.
- `npm run build`: passed. Upstream Zod annotation warnings remain.
- `/healthz` on ports 4317 and 4318: HTTP 200, `{"ok":true}`.
- Lockfile package-name scan: zero Radix or assistant-ui matches.
- `npm audit --omit=dev`: zero vulnerabilities. Full audit reports 11 moderate development-tool findings through minimatch. `npm audit fix` did not resolve them; its forced ESLint downgrade was not applied.

## Real connection status and limits

The executable opens real Pi Durable with the official OpenAI Codex provider and Sol 6.1. A real chat API prompt was attempted and correctly rejected as disconnected. Existing Pi auth contains no OpenAI Codex OAuth credential. The separate Codex auth format was not read or translated. The UI offers built-in Pi OAuth and always offers reconnect when configured credentials become invalid. No live Sol response or browser/sign-in interaction is claimed. No Claude calls were made.

This is a partial M0/M1 seed. No protected supervisor, rollback, safe mode, self-modification, remote pairing or tools were added. It is loopback development only. Both databases are in one data directory but are not one atomic transaction. Pi may briefly start recovery before startup aborts outstanding work. Retry repeats the last input in Pi context and retains all UI attempts. Production/static serving and remote auth remain later work. See `local-development.md` for routes, configuration and sign-in steps.

## Exact integration file list

- `apps/server/auth.test.ts`
- `apps/server/auth.ts`
- `apps/server/main.ts`
- `apps/server/pi.test.ts`
- `apps/server/pi.ts`
- `apps/server/server.test.ts`
- `apps/server/server.ts`
- `apps/web/BOARDUI-LICENSE`
- `apps/web/components/base/buttons/button.tsx`
- `apps/web/components/base/input/hint-text.tsx`
- `apps/web/components/base/input/input.tsx`
- `apps/web/components/base/input/label.tsx`
- `apps/web/components/base/textarea/textarea.tsx`
- `apps/web/index.html`
- `apps/web/main.tsx`
- `apps/web/postcss.config.mjs`
- `apps/web/style.css`
- `apps/web/styles/globals.css`
- `apps/web/styles/theme.css`
- `apps/web/styles/typography.css`
- `apps/web/utils/cx.ts`
- `apps/web/utils/directional-icon.ts`
- `docs/implementation-handover.md`
- `docs/local-development.md`
- `eslint.config.js`
- `package-lock.json`
- `package.json`
- `packages/protocol/index.ts`
- `packages/sdk/index.ts`
- `tsconfig.json`
- `vite.config.ts`
