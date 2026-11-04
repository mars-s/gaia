# Gaia

Gaia is an open-source agent you run on your own machine. It starts with a chat box and can propose changes to its own interface through checked, supervised releases.

The local macOS prototype includes Pi Durable chat, ChatGPT subscription sign-in, model and reasoning controls, image attachments, context compaction and an Electron window. The plain, themeable client uses unstyled assistant-ui with React Aria and existing Board UI components. Setup progresses through chat. Separate conversations appear only after the owner reviews and confirms a proposed workspace.

The managed server adds staged source changes, trusted checks, release probes, rollback, safe mode and change history. Home can route an explicit task to a confirmed area and return its real answer. Each area has separate conversation context, settings and drafts.

## Run locally

Use Node 24.21 or newer. From this checkout:

```sh
npm ci
GAIA_PORT=4317 npm run start:managed
```

In another terminal:

```sh
npm run desktop
```

The managed app opens at http://127.0.0.1:4317. Its first start installs a protected core and checks an owned source copy under `./data`. Later starts reuse that installation. To work directly on source with hot reload, use `npm run dev` instead of the managed server.

See [desktop setup](docs/desktop.md), [managed operation and limits](docs/managed-local.md), [checked owner upgrades](docs/owner-upgrades.md), [workspace contracts](docs/workspace-api.md), [verified local behaviour](docs/verification-2026-11-05.md), [development commands](docs/local-development.md) and the [locked specification](SPEC.md). Keep this prototype on loopback. Remote pairing, Linux sandboxing, arbitrary machine tools and production hosting remain outside this local slice.

Licence: Apache 2.0. Third-party components retain their licences. The client serves its included dependency notices at `/THIRD-PARTY-NOTICES.txt`.
