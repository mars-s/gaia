# Verification with the owner's plan

The plan lease is an operator command for isolated acceptance tests. It is off by default. It has no UI, HTTP route, supervisor command or model tool. It uses Pi OAuth subscription sign-in, never API keys.

The owner's Gaia must be stopped for the whole session. The broker holds the existing owner-upgrade, bootstrap and supervisor locks. It is the only process that opens and refreshes the owner's credential store. The test copy receives access tokens with a maximum 15-minute lease over a private Unix socket. It receives no refresh token and writes no credentials. Leases stop at the session deadline. Four hours is the default and twelve hours is the maximum.

Use a fresh test directory outside the owner's data directory. Existing managed test directories must already contain the new protected core. Bootstrap reuses an existing installed core, so restarting an old test install does not upgrade it.

## Acceptance commands

Run these only after the protected-core review and owner approval. This sequence is documentation. Implementation tests use synthetic data and never execute it against the owner.

First quit any Gaia desktop app. Inspect the leftover supervisor and stop it cleanly with SIGTERM. Do not delete live locks or use SIGKILL.

```sh
cd /Users/avi/Developer/vibe/gaia
owner_data=/Users/avi/Developer/vibe/gaia/data
owner_supervisor=$(cat "$owner_data/control/supervisor.lock")
ps -ww -p "$owner_supervisor" -o pid=,command=
```

Confirm that the command is this installation's protected `core/main.ts --installed` supervisor. Then run:

```sh
kill -TERM "$owner_supervisor"
for attempt in $(seq 1 30); do
  kill -0 "$owner_supervisor" 2>/dev/null || break
  sleep 1
done
if kill -0 "$owner_supervisor" 2>/dev/null; then
  echo 'Supervisor is still running. Stop here.'
  return 1 2>/dev/null || exit 1
fi
lsof -nP -iTCP:4317 -sTCP:LISTEN
```

No listener should remain. The broker also checks managed-child records and live lock holders before opening credentials. A leftover live holder must be stopped cleanly. Stale locks are reclaimed by the existing owner-lock helper.

Retire the old ignored operator script without opening its credential store. Its historical body remains below an unconditional refusal in the committed replacement:

```sh
install -m 600 \
  /Users/avi/.t3/worktrees/gaia/t3-4413ac1b/data/verification/four-profiles/live-fixture.ts \
  "$owner_data/verification/four-profiles/live-fixture.ts"
```

Run the broker from the reviewed source checkout. It must contain this implementation and its dependencies. No owner upgrade or owner runtime start is needed.

```sh
cd /Users/avi/.t3/worktrees/gaia/t3-4413ac1b
test_data=/Users/avi/Developer/vibe/gaia-acceptance/self-made-ui
mkdir -p "$test_data"
npm run plan-lease -- \
  --owner-data /Users/avi/Developer/vibe/gaia/data \
  --provider openai-codex --data "$test_data" --port 4347 --hours 4
```

In a second terminal, check:

```sh
curl --fail --silent http://127.0.0.1:4347/healthz
sqlite3 /Users/avi/Developer/vibe/gaia-acceptance/self-made-ui/credentials/oauth.sqlite \
  'SELECT count(*) FROM credentials;'
curl --silent -H 'Content-Type: application/json' \
  -d '{"provider":"openai-codex"}' \
  http://127.0.0.1:4347/api/v1/auth/connect
curl --silent -i -H 'Content-Type: application/json' \
  -d '{"provider":"openai-codex"}' \
  http://127.0.0.1:4347/api/v1/auth/disconnect
```

Health must show `planLease: true` and `mode: stable`. The credential count must be zero. Settings must show ChatGPT connected. Connect must show `Sign-in is off in this test copy. It uses the owner's plan.` Disconnect must return 409 and `Plan disconnect is unavailable.` Machine tools are disabled, including Shell and Agent Desktop. Self-change still uses the protected control socket.

Before the first model request, stop the broker with Ctrl-C and wait for its exit scan. Save a clean APFS baseline while all processes are stopped:

```sh
cp -cR /Users/avi/Developer/vibe/gaia-acceptance/self-made-ui \
  /Users/avi/Developer/vibe/gaia-acceptance/self-made-ui-baseline
```

Before each of the six acceptance runs, stop the broker and retain the previous run under a distinct name. Set `run_number` to the next unused run number:

```sh
run_number=1
mv /Users/avi/Developer/vibe/gaia-acceptance/self-made-ui \
  "/Users/avi/Developer/vibe/gaia-acceptance/self-made-ui-run-$run_number"
cp -cR /Users/avi/Developer/vibe/gaia-acceptance/self-made-ui-baseline \
  /Users/avi/Developer/vibe/gaia-acceptance/self-made-ui
```

Then start the same broker command. Record the preflight, prompt, captures and critic result. A critic that reports `The separate plan review was unavailable` fails acceptance. Negative proofs use `--test-provider` without a lease or broker.

After every run, stop with Ctrl-C and record `Leases granted: N` and `Lease tokens found in test data: none`. If files are named, retain them privately and investigate. Do not print their contents. The scan skips `dependencies/` and symbolic links.

Once the broker exits and releases the locks, restart the owner's existing install using its usual managed command, without `--plan-lease`, and check its connection. This does not install the new core into the owner runtime.

```sh
cd /Users/avi/Developer/vibe/gaia
GAIA_DATA_DIR=/Users/avi/Developer/vibe/gaia/data \
  GAIA_HOST=127.0.0.1 GAIA_PORT=4317 npm run start:managed
```

## Failure and access limits

A missing broker, wrong key, expired session or invalid reply fails closed. The lease store throws `The owner's plan is not available to this test copy.` Pi wraps this as an auth failure. The existing chat error stays plain. There is no retry loop, API key fallback, Pi refresh in the child or boot failure into safe mode.

This protects against accidental credential writes and double refresh. It does not isolate malicious code running as the same macOS user. Editable server code could read or write the owner's files directly. Disabling machine tools removes the easiest accidental path. Only a separate operating-system user would close that boundary.

An upstream bearer token can remain usable until its provider-set expiry, even after its local lease ends. The broker cannot revoke it early. Test calls consume the owner's plan usage. The broker can refresh the owner's stored credential while Gaia is stopped. Gaia uses that updated credential when restarted.

The earlier `data/verification/four-profiles/live-fixture.ts` now refuses before its historical body runs. Its old direct read-write owner-store pattern must never be used again. The owner's ignored copy is not changed by implementation work in a separate worktree. Replace that operator script with the committed refusing version before acceptance.

## Locked spec proposal

Proposed addition under plan sign-in, subject to the owner's separate decision. `SPEC.md` is unchanged:

> A verification-only plan lease lets an isolated test copy use the owner's plan while the owner's Gaia is stopped. It is off unless the owner starts it by hand.
