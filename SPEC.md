# Gaia: product spec and architecture

Status: locked v1.2, 4 Nov 2026. Decisions from Avi, 1 to 4 Nov 2026.

Changelog:
- v0.2 (4 Nov 2026): sign-in and model traffic through Pi's built-in OAuth; Electron gets full terminal and file access; generative UI is real code changes through the self-mod pipeline.
- v1.0 (4 Nov 2026): locked. Homelab hosting requirements added as v0.1 musts (see `docs/hosting.md`).
- v1.1 (4 Nov 2026): Avi removed the fixed 1 GB RAM requirement. RAM allocation can grow as homelab capacity is freed up.
- v1.2 (4 Nov 2026): Avi chose Board UI instead of assistant-ui. Use free MIT-licensed components with a plain default theme and editable theme tokens.

## One-line pitch

Gaia is an open-source agent you run on your own machine. It starts as a single chat box and grows its own interface, tools, clients and agents around how you work. An Apache 2.0, self-hosted replacement for Hermes Agent that feels like Grok Bot. One owner per install.

## Principles

- Seed, not suite: ships with a chat box and nothing else. Everything else is grown on request.
- The chat is the app. Generated UI grows out of it, not around it.
- Headless brain: the server owns no UI. Every UI is a client of one public protocol.
- Self-change is normal and safe: staged, checked, health-probed, auto-rolled back.
- Local and owned: data, credentials and memory stay on the owner's machine.
- Plan sign-in, no API keys: Claude and ChatGPT plans through Pi's built-in OAuth; all model traffic routed through Pi.
- The owner holds the power: full machine access by default, and the responsibility that comes with it.
- Plain by default: free MIT-licensed Board UI components, plain theme, restyled by asking through editable theme tokens. No Radix. Board UI's React Aria components replace the earlier assistant-ui and Base UI choices.
- Open from day one: Apache 2.0, commercial use allowed.

## User journeys

### First run

1. Owner runs `docker compose up` (or the native start command). Gaia prints an address and a one-time pairing code.
2. The page shows only a chat box. Gaia asks the owner to connect ChatGPT or Claude.
3. Gaia interviews: who you are, one or many life areas, where you sit from chat to agentic.
4. Gaia proposes a setup (single agent or one agent per area) and builds it after a yes.

### Multi-area person

Says: work, uni, health, finances. Gaia creates four agents with their own memory scopes and a Grok Bot-style sidebar, plus a home agent that routes and summarises.

### Single-purpose person

Says: I just want a research assistant. Gaia stays one chat, adds a citations panel and search tools, and does not push agents or sidebars.

### Make yourself a Grok Bot clone

Gaia stages a UI change: sidebar of agents with live animated status and web glyph icons, per-agent threads, routines. Checks pass, it swaps, the client hot-reloads. Revert is one click in change history.

### Build me an Android client

Gaia scaffolds an app on the client SDK, runs the conformance suite against its own server, builds an APK in a sandboxed build container, and hands over the file plus pairing steps. Same path for a Next.js web client.

## Architecture

```mermaid
flowchart TD
  clients["Clients: Electron, iOS, generated (APK, Next.js)"] --> proto["Versioned protocol + SDK"]
  proto --> server["Gaia server: Pi Durable runtime"]
  server --> prov["Pi OAuth: Claude, ChatGPT (Codex)"]
  server --> tools["Tools + MCP"]
  server --> mem["Memory plug-in (empty, Hindsight)"]
  server --> store["Store: threads, gen UI, themes, history"]
  server --> selfmod["Self-mod pipeline: worktree, checks, swap, probe"]
  selfmod -- "swap or rollback" --> sup["Supervisor + safe mode"]
  sup -- "restarts" --> server
```

- Server: headless Node service on Pi Durable. Runs agents, durable workflows, compaction, tools and MCP.
- Providers: sign-in uses pi-ai's built-in Anthropic (Claude plan) and OpenAI Codex (ChatGPT plan) subscription logins. All model traffic goes through Pi, including native web search.
- Supervisor: a tiny, never self-modified process that starts the server, probes health and owns rollback.
- Generative UI: real code changes to the app itself. The AI may change any part of the UI, through the self-mod pipeline. The server serves the current UI modules; clients load them.
- Electron client: pairs once with a one-time code, like a Grok Bot computer, then gives the agent full terminal and file access on the Mac. No sandbox or command scoping in v0.1.
- Memory: empty by default behind a pluggable memory interface (for example Hindsight).

## Self-modification safety model

1. Propose: the agent writes a change set with a reason, in a fresh git worktree, never the live tree.
2. Check: typecheck, lint, unit tests, protocol conformance, and a boot test of the staged build in a sandbox.
3. Gate: if approval mode is on, the owner sees the diff and approves. Off by default; the owner can turn it on, or ask Gaia to.
4. Swap: supervisor snapshots the current release, then atomically points to the new build.
5. Probe: health endpoint, a scripted chat turn, and client reconnect within a time limit.
6. Rollback: any failed probe or crash loop restores the snapshot automatically and logs why.
7. Safe mode: after repeated failures, boot the last known-good core with self-mod disabled and a plain chat to diagnose.
8. History: every change is a commit with reason, checks and outcome; any one can be reverted.

> Protected core that self-mod cannot touch: the watchdog supervisor, rollback logic, safe mode and auth. Everything else, including every part of the UI, is fair game. The protected core is what makes free changes survivable.

## Protocol outline

| Area | Covers |
| --- | --- |
| Session | Pairing, device tokens, protocol version negotiation |
| Events | Streamed messages, tool-call hints, compaction notices, agent status |
| Tools | Calls, results, client-side tools (full terminal, files) offered by a client |
| Approvals | Permission prompts, self-mod approvals, decisions |
| Files | Upload, download, previews |
| Gen UI | Versioned UI code bundles and modules served by the server; clients load and hot-swap them, falling back to the last good bundle |
| Admin | Change history, revert, safe mode, diagnostics |

Ships with a TypeScript SDK and a client conformance suite. Breaking changes bump the major version.

## v0.1 requirements (musts)

Hosting (detail in `docs/hosting.md`):

- Runs natively as a Node service under systemd; ships a systemd unit or a single start command. Docker Compose also supported.
- Small footprint: target 2 vCPU, 512 MB swap, 16 GB disk. No fixed RAM limit; size RAM for the runtime, builds and checks.
- One configurable data dir (default `/var/lib/gaia`) holds all data and the self-modifying git repo, for easy backups.
- Configurable bind address and port; trusted reverse proxy support; plain HTTP behind the proxy.
- Default port must avoid 8096, 8264 and 8090.
- Outbound HTTPS only; no inbound requirement beyond the proxy.
- Health endpoint (for example `GET /healthz`) used by the supervisor and the proxy.

## v0.1 scope versus later

| v0.1 | Later |
| --- | --- |
| Docker Compose and native systemd seed | LXC template, Nix package |
| Chat box, tool hints, compaction hints | Rich trace and DeepSeek-style views (generated) |
| Claude and ChatGPT sign-in via Pi OAuth | More providers |
| Onboarding interview, multi-agent setup | Routines, cross-agent planning |
| Self-mod pipeline, safe mode, history | Approval mode polish |
| Protocol v1, SDK, conformance suite | Generated Android and Next.js clients |
| Electron client, full terminal and file access | iOS client; optional restricted mode |
| Memory interface, empty default | Hindsight adapter |

## Borrow from Aegis and Mars

- Mars (github.com/mars-s/mars): Pi Durable host (`packages/pi-host`), owner sign-in URL from setup, ChatGPT and Claude connection, staged host changes with health check and rollback watchdog, plugin cards and on-demand tool discovery. Gaia uses Board UI for chat.
- Aegis (github.com/mars-s/Aegis): first-run greeting and local profile, patched UI that yields to newer built-ins after update, Tauri signed updater with backup and restore, DESIGN.md discipline.
- Leave behind: Aegis's canvas and Tauri shell, Mars's Next.js-coupled UI.

## Risks and open questions

- Naming: many projects use Gaia. GitHub repo is free; npm package and domain will likely need a suffix.
- Terminal access: unrestricted by design. A bad agent action can damage the Mac; the owner accepts that. Restricted mode comes later.
- Self-mod failures: tests that pass but break UX, migrations that cannot roll back, corrupted data. Needs data snapshots, not just code.
- Public address: needs TLS, pairing codes, device tokens, rate limits; default to LAN or tunnel only.
- Decided: gen UI is real app code changed through the self-mod pipeline, not declarative data.
- Open: how generated clients get signed and distributed.

## Milestone plan

1. M0: write protocol v1, supervisor design and repo skeleton (Apache 2.0).
2. M1: headless server with Pi Durable, plan sign-in, minimal web chat at the printed address, systemd unit and health endpoint.
3. M2: self-mod pipeline, safe mode and change history, tested with forced failures.
4. M3: onboarding interview and multi-agent setup.
5. M4: Electron client with pairing and full terminal and file access.
6. M5: UI code serving and hot-swap for gen UI; demo Grok Bot clone and solar system.
7. M6: public launch: docs, conformance suite, Compose image.
8. M7: iOS, LXC and Nix, generated Android and Next.js clients.
