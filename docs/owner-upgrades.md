# Upgrade Gaia as the owner

Use this command to install reviewed, committed runtime source into a managed local Gaia installation. It is separate from self-change. It exposes no server route, Pi tool, or automatic approval. Run it as the filesystem owner of the data directory, using Node 24.21 or newer on macOS. The existing fixed recipe requires `sandbox-exec` and fails closed on other platforms.

## Prepare committed source

Review and commit the intended runtime changes first. Preparation exports **HEAD**, even if the checkout has uncommitted edits. Untracked files never enter the export. Only committed files in `apps`, `packages`, `core`, `selfmod`, and `scripts/owner-upgrade`, plus the six runtime root files, enter the private staged repository. Hidden files, data, credentials, generated files, symlinks, and Git submodules are refused or excluded. The export uses `git archive HEAD`; its bytes are checked against the Git blobs. The staged repository has its own `.git` directory and local `gaia@localhost` identity.

```sh
npm run owner-upgrade -- prepare --data /absolute/path/to/gaia-data
```

To prepare another checkout's committed HEAD, add `--source /absolute/path/to/checkout`. Save the returned `preparedFile` path. Inspect `prepared.json`, the staged diff, `coreChanges`, dependency identity, and `checks.json` before activation. Preparation may run while Gaia is active. A changed control record makes the preparation stale at activation.

The command runs the original six fixed recipe gates in order. These are typecheck, lint, server and web unit tests, web build, sandbox boot and isolation, and protocol conformance. It does not invoke candidate package scripts. The trusted recipe discovers only server and web tests, so it does not recursively run operator preparation tests. Desktop and operator checks are separate repository checks.

## Allow exact reviewed core files

Core changes are refused by default. To authorise reviewed core changes, repeat `--core` for every changed file. For the current child update, use the following command only if those two files actually changed.

```sh
npm run owner-upgrade -- prepare --data /absolute/path/to/gaia-data \
  --core core/child.ts --core core/child.test.ts
```

If the reviewed commit also adds helpers under `core/testing`, add each actual changed helper path separately. Wildcards and directory allowlists are unsupported. Unchanged paths, duplicate entries, unapproved changes, and core removals fail preparation. Each changed file records `beforeHash` and `afterHash`. An added file records `beforeHash: null`.

Activation compares the actual old and new core file sets with the prepared inventories and change records. It also compares the installed candidate core with the committed staged core. Rewriting local `integrity.json` cannot authorise different core bytes. This owner command does not relax any self-change path restriction or edit the protected algorithms itself.

## Provision dependencies separately

The existing Pi AI and Pi Durable pins must remain exactly `1.5.0`. Electron must remain exactly `45.2.2`. Existing dependency declarations cannot change or be removed. Added dependencies need exact versions. Both old and new installed versions are checked against their lockfiles, including the three fixed pins.

If the lockfile changes, preparation copies the new manifest and lockfile into `DATA/dependency-sets/<id>` and runs a complete `npm ci` there. It includes development and optional dependencies, permits lifecycle scripts, and uses a private cache and empty npm configuration files. The install has a ten-minute deadline and bounded registry retries. It never runs npm against the live `DATA/dependencies/node_modules` directory.

Preparation explicitly resolves `require('electron')` in the new set with a five-minute deadline. Electron 45 can download its executable lazily. The command checks that the resolved executable exists, has execute permission, and has the pinned distribution version. It also runs esbuild's executable. npm verifies package archive integrities from the lockfile. Bundled packages inherit their enclosing archive's integrity.

A ready identical set is reused only when the manifest hash, lock hash, Node version, platform, architecture, readiness record, installed package versions, and binary checks still match. Incomplete sets are refused. Preserve a failed set for inspection before moving it aside and preparing again. The identifier includes both manifest and lock hashes, so a metadata-only change can deliberately exercise a separate set.

Readiness is evidence of a completed npm install and current version and binary checks. It is **not** a cryptographic hash of the installed dependency tree. The unchanged-lock path records only `installed-versions-and-binaries`. A local owner can modify dependencies or journals. Neither these files nor Gaia's same-user filesystem conventions provide protection from a hostile local user. npm lifecycle code is owner-reviewed executable code and can download public installation artifacts, including Electron.

## Activate while stopped

Stop the managed owner and desktop client first. Keep the installation stopped throughout activation and recovery. Use the exact prepared file returned above.

```sh
npm run owner-upgrade -- activate \
  --prepared /absolute/path/to/gaia-data/operator-upgrades/ID/prepared.json
```

Activation refuses a live bootstrap lock, supervisor lock, or managed child. It takes both existing managed-owner locks plus a separate operator lock, rechecks the prepared source identity, source and build hashes, core changes, dependencies, and all four original control records. A stale preparation requires a fresh prepare.

Activation copies the offline conversation generation once and compares all copied file hashes and SQLite `user_version` and definitions. It leaves the old generation and independent credentials untouched. It installs a separate code release and protected core, then saves byte-exact backups of `core.json`, `protected.json`, `manifest.json`, and `history.json`.

Before the first live pointer changes, it durably writes `activation.json`. A dependency switch preserves the original actual directory by rename into the journal directory, or preserves the original symlink and its exact target by rename. It then atomically renames a new symlink into the canonical dependency location. New release and core `node_modules` links use that canonical location. The active and safe baseline pairs both name the new code and copied generation.

The command returns `runtimeVerified: false`. It does not restart Gaia. Start it deliberately after inspecting the result, then verify health, a real chat turn, and client reconnection separately. The deterministic test proof does not verify a subscription session or native desktop interaction.

## Restore or recover an interruption

If activation fails after a live pointer changes, it attempts recovery immediately. For an interrupted process or a deliberate owner rollback, keep Gaia stopped and use the saved journal.

```sh
npm run owner-upgrade -- restore \
  --journal /absolute/path/to/gaia-data/operator-upgrades/ID/activation.json
```

Restore checks every current control file against the recorded old or new bytes before changing anything. It checks the original and replacement dependency filesystem identities and exact symlink targets. A foreign replacement or later release is refused. Restore returns the original directory or symlink and all four control records exactly. Repeating restore is safe. Do not restore after allowing writes to the new generation without first deciding how to retain those new messages. Restore returns to the old generation.

Dependency replacement and four control writes are an **offline multi-file transaction**. Each rename or control write is atomic, but the whole operation is not. A killed process can leave dependencies temporarily absent between renames, or leave mixed old and new control records. Do not start Gaia in that state. The durable journal supports recovery from either dependency rename gap, a partially written control sequence, or an interrupted restore. Dead process locks are reclaimed on the next command. Invalid or live locks fail closed.

If `activation.json` exists, recover it before another activation attempt. If no journal exists, the command has not changed the canonical dependencies or controls. Partial staged releases, copied generations, and incomplete dependency sets can remain for inspection. New releases, prepared source, ready sets, and old generations are retained after restore. There is no automatic garbage collection. Keep the journal and original dependency backup until you no longer need rollback.

## Check the implementation

```sh
npm run typecheck
npm run typecheck:desktop
npm run lint
npm test
npm run build
npm run check:protocol
npm run test:owner-upgrade
```

Operator tests use synthetic filesystems, SQLite data, credentials, and an injected installer. The complete provisioning proof is opt-in to avoid repeatedly installing a full desktop dependency tree. It uses a temporary data directory, ephemeral ports, deterministic model responses, and an existing public Electron cache archive. It never activates real owner data.

```sh
GAIA_OWNER_REAL_PROVISION=1 \
GAIA_OWNER_PROOF_MODULES=/absolute/path/to/existing/complete/node_modules \
GAIA_OWNER_ELECTRON_CACHE=/absolute/path/to/cached/electron/archive-directory \
node --import ./node_modules/tsx/dist/loader.mjs --test scripts/owner-upgrade/proof.test.ts
```

The archive directory must contain the cached Electron 45.2.2 zip at its usual cache key. The proof copies it into the isolated HOME before resolution, so its binary needs no separate download. npm package traffic uses the public registry. The proof exercises a separate complete dependency set using harmless manifest and lock metadata changes, reuse of that ready set, the six real fixed gates, activation, a manually started deterministic runtime, exact message and skipped-profile retention, SQLite definition checks, separate synthetic credentials, and restore.
