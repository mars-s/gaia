# Chat upgrade installation

This owner-authored upgrade adds optional protocol fields and tests. It is outside the editable self-modification slice. Do not disable protected hash checks or database guards to promote it.

The parent operator owns the installation and runtime change. Stop and drain the managed service, back up its complete data directory, and record the active manifest, release and generation before replacing the protected installation. Create a deliberate installation from the reviewed commit using the normal bootstrap process, retaining the current generation data. Do not copy a new protocol file into an existing protected installation or edit its hash manifest to bypass verification.

Pinned changes include `packages/protocol/index.ts`, the additive `packages/protocol/attachments.ts`, `apps/server/controls.test.ts` and `apps/server/attachments.test.ts`. Install the complete reviewed source and refreshed protected baseline tests together. There are no dependency, config or core changes and no SQLite schema migration.

Retain `gaia.sqlite`, `pi.sqlite`, `owner-profile.json`, the generation's `attachments` directory and every other file in the generation. Never reset chat or derive a confirmed owner profile from old conversation text. The real 29-message baseline and skipped profile are parent acceptance inputs. The implementation worktree contains no live data.

Before starting normal traffic, run the pinned checks and protocol conformance against a disposable copy. Then verify exact history-prefix equality, selected effort after restart, and the unchanged skipped owner state. Keep the original installation and generation backup available for operator recovery. This document does not claim that a protected upgrade or live provider check has run.
