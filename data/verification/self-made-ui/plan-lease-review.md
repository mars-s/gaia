# Plan lease review: stopped-owner login pass-through

Reviewer: Claude Opus 5.5 (independent security review). Date: 8 Nov 2026.
Branch: `t3/stopped-owner-oauth-lease`, `git diff 9a8f112..e8d8f2e`, worktree `/Users/avi/.t3/worktrees/gaia/t3-4413ac1b`.
Design: `data/verification/self-made-ui/auth-pass-through.md`.
Mode: read only. No code edited, no broker run, the owner's `data/` not touched.

## Verdict

**Merge after one small fix. Then use it for acceptance.**

The build matches the design closely. The safety core is right: the broker is the only writer, the test copy never gets a refresh token, Pi's refresh cannot run in the test copy, and a normal owner start with no flag works exactly as before.

There is one must-fix. The broker drops its signal handlers before it finishes cleaning up. A second Ctrl-C in that gap kills it at once, and that can cut off a refresh halfway. That is the one way this branch could still sign the owner out. The fix is about three lines.

The rest are should-fix items: doc paths, test gaps and wording. None of them blocks acceptance once the must-fix lands.

Still needed before merge (from the design's approval table): owner approval of the protected-core change, and the owner's yes or no on the SPEC line.

## What I checked and ran

- Read the full diff, the design (with its threat model and approval table), `core/auth.ts`, `core/child.ts`, `core/main.ts`, `core/supervisor.ts` boot and close, `core/process.ts` `cleanEnv`, `core/install.ts`, `scripts/owner-upgrade/ownership.ts`, Pi's `auth/resolve.js` and `models.js` `logout`, and tsx's signal relay (`dist/cli.mjs`, `dist/preflight.cjs`).
- `npx tsx --test core/plan-lease.test.ts core/plan-lease-child.test.ts scripts/plan-lease/broker.test.ts`: 31 pass, 0 fail.
- `npx tsx --test apps/server/auth.test.ts apps/server/claude-models.test.ts apps/server/plan-models.test.ts core/safety.test.ts`: 16 pass, 0 fail.
- `npx tsc --noEmit`: clean.
- `git merge-tree --write-tree main e8d8f2e`: merges cleanly onto main (`f2018d1`, 3 commits ahead of the base, one of them a core refactor).
- `ps` and `lsof` only, to see the owner's real process state. Supervisor 46601 is alive, under bootstrap 46599, tsx 46598 and an orphaned `npm run start:managed` (46571, parent pid 1). It has no managed child, and nothing listens on 4317.

## Must fix

### 1. A second Ctrl-C during broker cleanup can cut off a refresh and sign the owner out

- File: `scripts/plan-lease/broker.ts:90-103`.
- What happens: the `SIGINT` and `SIGTERM` forwarders are removed in the inner `finally` (line 98), as soon as the test copy exits. The outer `finally` then still has to close the server, wait for `auth.close()` (which waits for any refresh still running), close the DB, scan and release the locks. The broker runs under tsx. tsx's preflight handler calls `process.exit(130)` when a signal comes in and no user listener is left (`preflight.cjs`, `hiddenHandler`). Plain Node does the same by default.
- How it goes wrong: a lease request comes in just before the test copy dies. That is likely, because the test copy may be finishing a model call while it shuts down. The owner token has less than 20 minutes left, so Pi starts a refresh. The provider rotates the refresh token. The operator presses Ctrl-C again because shutdown feels slow, and the doc tells them to Ctrl-C and wait. The broker exits before `INSERT OR REPLACE` runs. The new refresh token is lost and the old one is now dead, so the owner has to sign in again. Pi's comment at `resolve.js:53-58` warns about exactly this case.
- Odds: low. It needs a refresh in flight (roughly once per Claude session, rarer for ChatGPT) plus a second signal within about 15 seconds. But the cost is the one thing the design exists to prevent, and the fix is tiny.
- Fix: keep a handler registered until the outer `finally` has finished. For example, register once at the top of the session, `const hold = () => log("Finishing up. Please wait.");`, keep `forward` for while the child runs, swap `forward` for `hold` instead of removing everything, and only `process.off` `hold` after `log("Leases granted: …")`. Also register `SIGHUP` the same way, so closing the terminal window does not kill the broker mid-refresh. Add a test: start a refresh stub that waits on a promise, kill the child, emit `SIGINT` twice, release the stub, then check the owner row holds the rotated token and the locks are gone.

## Should fix

### 2. The doc points at a throwaway worktree, and its fixture step is wrong after merge

- File: `docs/plan-lease.md:42-50` and `:111`.
- What happens: the broker command and the `install -m 600` source both hard-code `/Users/avi/.t3/worktrees/gaia/t3-4413ac1b`. Once merged, that worktree can be cleaned up and the commands break. Also, `data/` is git-ignored (`.gitignore:15`) and this branch force-adds `data/verification/four-profiles/live-fixture.ts`. Git overwrites ignored files without asking. So merging into the owner checkout already replaces the owner's ignored copy with the refusing version. The `install` step is then redundant, and the sentence "The owner's ignored copy is not changed" is no longer true.
- Fix: after merge, run the broker from `/Users/avi/Developer/vibe/gaia`. Replace the `install` step with a check: `head -1 data/verification/four-profiles/live-fixture.ts` must show the `throw`. Say plainly that the merge replaces the old copy.

### 3. The stop sequence waits for the supervisor only, and has no next step for a stuck one

- File: `docs/plan-lease.md:13-37`.
- What happens: after the supervisor exits, the bootstrap (46599) removes `bootstrap.lock` and exits a moment later. If the operator starts the broker in that gap, it refuses with the generic "could not start" message. Separately, if `supervisor.lock` is missing, `$owner_supervisor` is empty and `ps` and `kill` fail in confusing ways. If the supervisor will not exit in 30 seconds, the doc says "Stop here" with no next step. That case is real: the live supervisor has no child. Also, `return 1 2>/dev/null || exit 1` pasted into an interactive zsh can close the terminal.
- Fix: read both `bootstrap.lock` and `supervisor.lock`. Stop if either file is missing or names a process that is not this install's `core/main.ts`. Wait until both PIDs are gone. Replace `return … || exit` with a plain `echo` and an instruction to stop. For a supervisor that will not exit: the supervisor process never opens the credential store (only the managed child does), so once `ps` shows no `--managed-child=…/gaia/data` process, it is safe for credentials to report back and decide on SIGKILL. The broker will reclaim the stale locks.

### 4. No test drives the real launch path: broker, then main, then supervisor, then child

- Files: `scripts/plan-lease/broker.test.ts:58-61` (the `launch` hook ignores `command` and `args`), `core/plan-lease-child.test.ts` (spawns `child.ts` directly).
- What happens: if the broker dropped `--plan-lease`, or `main.ts` or the supervisor stopped passing it on, every test would still pass. The test copy would boot on its empty SQLite store. That is not dangerous, and acceptance's `/healthz` check would catch it. But the "inert by default" proof only covers `child.ts`, not `main.ts` and `supervisor.ts`.
- Fix: in the broker test, assert `args` ends with `core/main.ts` and `--plan-lease`. Add one managed boot test: `main.ts --installed --plan-lease` with a fake broker, then check that `/healthz` shows `planLease: true` and that the supervisor's own `process.env` has no `GAIA_PLAN_LEASE_KEY`. Add the same boot without the flag but with the lease env set, then check `/healthz` has no `planLease`.

### 5. The broker launch paths depend on the working directory

- File: `scripts/plan-lease/broker.ts:87`.
- What happens: `resolve("node_modules/tsx/dist/loader.mjs")` and `resolve("core/main.ts")` use `process.cwd()`. `npm run` sets that to the package root, so the documented command works. Run the CLI any other way (for example `npx tsx /path/to/cli.ts` from the owner checkout before merge) and it starts a different checkout's `core/main.ts`. That one may not know `--plan-lease`.
- Fix: resolve both from `fileURLToPath(new URL("../..", import.meta.url))`.

## Low, for the record

6. **The key is still in each process's original environment.** `core/child.ts:28` and `core/main.ts:121` delete it from `process.env`. But on macOS, `ps -wwE -p <pid>` reads the environment the process started with, and the bootstrap never deletes the key at all. Same-user code can read it. Other macOS users cannot. This sits inside the "compromised test copy" limit, which can already read `oauth.sqlite` from disk. Fix: in `docs/plan-lease.md`, say "not in `process.env`" rather than "editable code cannot read the key".
7. **The exit scan is a tripwire, not proof.** `broker.ts:104-117` matches exact bytes. A token stored in a SQLite row across an overflow page, or saved in an encoded form, is missed. A scan error (such as `EACCES`) also surfaces as "Plan lease could not start" (`cli.ts:11-12`) and hides `Leases granted`. Fix: call it best-effort in the doc. Catch scan errors and print `Lease token scan failed` instead.
8. **The broker's 5-second socket deadline is shorter than Pi's 15-second refresh timeout.** `broker.ts:50`. A slow refresh still saves correctly, but that lease request fails. If it was the critic's call, the run fails as "The separate plan review was unavailable". Fix: use a 20-second deadline on both ends, or note the cause in the run report if it happens.
9. **Refresh on every request if a provider ever issues tokens shorter than 20 minutes.** `broker.ts:70`. Pi refreshes and then throws "expires too soon", so each request rotates the refresh token and returns `{ ok: false }`. Neither provider does this today. Fix, if wanted: after that error, refuse leases for a minute without calling Pi.
10. **The retired fixture still loads its imports.** `data/verification/four-profiles/live-fixture.ts:1`. ES module imports load before the `throw`. They have no side effects today, and the test proves the refusal. But the full read-write owner-store body is still there, under one line. Fix: delete the body. Git history keeps it.
11. **`/healthz` says `provider: "pi-openai-codex"` for a Claude lease.** `core/child.ts:153`. Cosmetic, but it could confuse the Claude preflight. Fix: report `lease.provider` when leased.
12. **Merging changes the owner's bootstrap.** `npm run start:managed` runs the checkout's `core/main.ts` as the bootstrap. The new code is inert without `--plan-lease`, so this is fine. It does mean the design's line "the owner's live runtime needs no upgrade" holds for the installed core, not the bootstrap.

## Checked and correct

- **Single writer.** The broker opens the owner store through `createAuth`, under the in-process queue. Pi re-checks expiry under that lock (`resolve.js:75`), so five concurrent leases mean one refresh (tested). A failed refresh leaves the owner row byte-identical (tested). `models.logout` only deletes from the local store and makes no upstream revoke call, so it cannot sign the owner out through the provider.
- **No refresh token and no owner writes in the test copy.** The reply schema is strict and built from `access` and `expires` only. The client rejects a reply carrying `refresh` (tested). The child's credential DB is the test store, with 0 rows after connect, chat and close (tested).
- **Pi's refresh never runs in the test copy.** `oauth.refresh` is only called inside the `modify` callback (`resolve.js:78`). The lease `modify` never calls the callback (tested with a stub that counts calls).
- **Locks.** `withOwnerLock(owner, true)` takes `owner-upgrade.lock`, `bootstrap.lock` and `supervisor.lock`, then re-checks lock PIDs and `child.json` with a `ps` marker match. Owner start, a second broker and an owner upgrade are all refused (tested). Stale locks are reclaimed and released on normal exit, crash, signal and throw (tested). The existing `lockFile` in `main.ts` has a small check-then-remove race on stale locks. It is pre-existing, and the second lock plus `assertStopped` cover it.
- **Socket and key.** The socket is in a fresh `mkdtemp` folder, mode 0700, under per-user `$TMPDIR`, outside both data dirs (tested). The key is 32 random bytes, passed in env only, never in argv, on disk or in logs (tested). It is compared with `timingSafeEqual` after a length check (1,000 random keys refused, tested). There are caps of 4 KB per request, 8 connections and 5 seconds, and the broker keeps serving after a 5 MB request, a half-open connection and 50 parallel requests (tested).
- **Expiry and revocation.** Leases stop at `min(token, 15 min, deadline)`. The deadline is enforced on the broker (tested). The client refuses `expires` in the past or more than 15 minutes ahead. The socket is removed on exit, and the client then fails closed (tested).
- **Fail closed.** Every failure is one fixed error with no `cause` (tested for a missing socket, a stall, bad JSON, an oversized reply, extra fields, `{ ok: false }` and a stale expiry). There is no API key fallback, with `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` set (tested). With the broker down, boot does not go to safe mode and the failure count stays 0 (tested).
- **Machine tools off, no new reach.** `tools: undefined` in lease mode (tested). Disconnect returns 409. Connect shows the fixed refusal and starts no login (tested). There is no new HTTP route or supervisor command, and `Command` refuses `lease` and `refresh` (tested). Sandbox candidates get `cleanEnv()` and no lease, and the sandbox denies the socket with `EPERM` (tested).
- **Inert by default.** Without the flag, `createAuth(db, undefined)` builds the same store, connected set and `connect`. The service object and `/healthz` are unchanged. Lease env without the flag is ignored (tested at the child level). The existing sign-in tests pass for ChatGPT and Claude.
- **Size.** Protected runtime growth is about 80 lines, including `core/plan-lease.ts` at 56. That is under the 90-line stop line.

## Using it for acceptance

1. Land must-fix 1. Rerun `npm run typecheck`, `npm run lint` and the full `npm test` on the tree merged with current main.
2. Get owner approval for the protected-core change, and the owner's decision on the SPEC line.
3. Follow `docs/plan-lease.md` with fixes 2 and 3 applied. Run the broker from the merged owner checkout. Stop the leftover supervisor (46601) and wait for its bootstrap too.
4. Press Ctrl-C once, then wait for `Leases granted`, even after fix 1 lands.


## Owner approval, 8 November 2026

The owner approved the protected-core plan-lease change and authorised a fast-forward push to `origin/main` after the requested spec update, fixture repair and checks. This approval covers the protected-core content verified at `81009d9384e9b60a1cc72161bdc8e89eab73ec57`, including the review fixes. The subsequent spec and test-fixture changes do not alter that protected-core content.

The owner also approved the exact verification-only lease principle, now recorded in SPEC v1.6 dated 8 November 2026. The broker remains manual and off by default.

The required repeated-signal fix was verified with real SIGINT, SIGTERM and SIGHUP signals while a synthetic refresh remained in flight. The rotated credential was saved before locks were released. Complete managed start-path and inert-by-default tests also passed.

No broker run against real owner data is authorised by this implementation task. The owner runtime, its processes and credentials remain outside the task. This record was written in the implementation worktree; the owner's data directory was not edited.
