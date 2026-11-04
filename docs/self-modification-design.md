# Local self-modification design

This implements the locked spec's safety model for the local Mac build. It follows two independent Sol 6.1 design reviews on 4 November 2026.

## Release ownership

Use stop, switch and restart. The protected supervisor owns the active child process, deadlines, recovery journal, history and safe mode. A short disconnect during switching is expected. The client reconnects through the public protocol.

The supervisor, rollback, safe-mode and auth implementation live outside the repository Gaia edits. Auth credentials have their own store, separate from conversation snapshots. A rollback must never restore an expired OAuth refresh token over a newer one.

Under the configurable data directory, keep the editable git repository, staged worktrees, immutable releases, conversation data generations, snapshots, protected installation and supervisor control state. Development source remains in this checkout.

## Transaction

The persisted deployment state is a discriminated union with stable, checking, switching, probing and safe variants. One atomically replaced manifest names both the code release and its data generation. Recovery reads this journal before starting any child.

1. Create a worktree from the active commit and apply the agent's real file edits there. Refuse protected paths, symlinks and path traversal. Serialize deployments.
2. Run a trusted recipe for typecheck, lint, unit tests, protocol conformance, build and an isolated candidate boot. Candidate code cannot replace the trusted recipe. Record the diff, reason and results in history.
3. Commit a verified candidate. Gate ordinary writes, finish or cancel an active turn and stop the previous child. Take consistent SQLite snapshots after the databases are closed.
4. Create the candidate data generation from the snapshot. Atomically persist the candidate manifest and probing state, then start the candidate on the configured local port.
5. Probe health, a scripted chat turn in a dedicated probe conversation and an actual event-stream reconnect with candidate release identity. Keep ordinary writes gated until all probes pass.
6. On success, mark stable and allow writes. On failure, restore the previous manifest, restart the previous child and record the rollback reason. Since normal writes were gated, restoring the previous data generation cannot lose a newly accepted user message.
7. Repeated deployment failures or a crash loop enter safe mode. Start the pinned known-good chat with self-modification disabled. Revert uses the same switch and probe path.

Keep the conversation schema unchanged in this first implementation. Reject schema changes until they have a tested migration and recovery contract. Credentials are outside these generations.

## Verification

Verify successful visible code changes, failed checks, isolated boot failure, failed chat and reconnect probes, crashes around persisted transitions, supervisor restart during probation, concurrent-deployment refusal, protected-path rejection, repeated-failure safe mode, history and revert. Check conversation preservation and separate credential storage through recovery.

Use deterministic adapters for repeatable failure tests. Separately prove live Sol 6.1 chat and a real agent-authored UI change. Observe the running app with agent-desktop, including reconnection and the changed interface.

## Protection boundary

The supported self-change API enforces the protected paths. Processes running as the same macOS user can bypass filesystem conventions through arbitrary code or terminal access. This local prototype must not claim an operating-system security boundary. The staging sandbox is a separate, verified requirement, and must fail closed if it cannot be established.
