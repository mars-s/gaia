# Gaia

Gaia is an open-source agent you run on your own machine. It starts with a chat box and can propose changes to its own interface through checked, supervised releases.

The local macOS prototype includes Pi Durable chat, ChatGPT subscription sign-in, a plain Board UI interface, a model picker, context compaction and an Electron window. The managed server adds staged source changes, trusted checks, release probes, rollback, safe mode and change history.

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

See [desktop setup](docs/desktop.md), [managed operation and limits](docs/managed-local.md), [development commands](docs/local-development.md) and the [locked specification](SPEC.md). Keep this prototype on loopback. Remote pairing, Linux sandboxing, arbitrary machine tools and production hosting remain outside this local slice.

Licence: Apache 2.0. The copied Board UI components use their included MIT licence.
