# Chat upgrade installation

This owner-authored upgrade adds optional protocol fields and tests. It is outside the editable self-modification slice. Do not disable protected hash checks or database guards to promote it.

The parent operator owns the installation and runtime change. There is no in-place protected-upgrade command. Re-running `start:managed` with the existing data directory reuses its old core, repo and manifest. Deleting only `control/core.json` is insufficient. Do not patch protocol files or hash manifests inside an installed baseline.

Use a fresh installation directory and retain the old one for recovery:

1. Drain and stop the old managed service. Back up its complete data directory and record `control/manifest.json`, including `active.release` and `active.generation`. Confirm all processes using that generation have exited before copying SQLite files.
2. From the complete reviewed checkout, create a fresh installation at a different `GAIA_DATA_DIR`, on an available operator-selected port, using `npm run start:managed -- --test-provider`. This builds the new protected installation and baseline with deterministic probes. It is a rehearsal, not live-provider acceptance. Do not copy the old `repo`, `protected`, `control`, `releases` or `node_modules` into the new installation.
3. Stop that service. Read its new manifest to locate `generations/<active.generation>`. While both services are stopped, replace this newly created disposable generation's contents with the complete old active generation. Include `gaia.sqlite`, `pi.sqlite`, `owner-profile.json`, `attachments` and other generation-local files. Keep its new generation directory name and the new manifest unchanged. The new baseline's active and good pair both refer to this generation. Do not import the old files only as seed databases, because the current seed importer does not copy owner profiles or attachment directories.
4. Transfer the separate `credentials` directory as an opaque operator-owned copy, without printing or inspecting its contents. Preserve restrictive permissions. Keep old self-change history and snapshots in the complete old installation backup. Do not replace the new installation's hash inventory or recovery journal with old control files.
5. Start the new installation without `--test-provider`, on the intended existing service address. Verify the checks and acceptance below before normal traffic. Update the service's configured data directory only after acceptance. If acceptance fails, stop it and return to the untouched old installation and its original address.

This procedure is required because protocol and baseline test changes are deliberately pinned. The implementation sub-agent does not perform any of these operator actions.

Pinned changes include `packages/protocol/index.ts`, the additive `packages/protocol/attachments.ts`, and the changed or added chat, profile and web tests. Install the complete reviewed source and refreshed protected baseline tests together. The SDK onboarding additions must accompany the server and UI. There are no dependency, config or core changes and no SQLite schema migration.

Retain `gaia.sqlite`, `pi.sqlite`, `owner-profile.json`, the generation's `attachments` directory and every other file in the generation. Never reset chat or derive a confirmed owner profile from old conversation text. The real 29-message baseline and skipped profile are parent acceptance inputs. The implementation worktree contains no live data.

Before starting normal traffic, run the pinned checks and protocol conformance against a disposable copy. Then verify exact history-prefix equality, selected effort after restart, and the unchanged skipped owner state. Keep the original installation and generation backup available for operator recovery. This document does not claim that a protected upgrade or live provider check has run.
