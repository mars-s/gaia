# Verification with the owner's plan

The plan lease is an operator command for isolated acceptance tests. It is off by default. It has no UI, HTTP route, supervisor command or model tool. It uses Pi OAuth subscription sign-in, never API keys.

The owner's Gaia must be stopped for the whole session. The broker holds the existing owner-upgrade, bootstrap and supervisor locks. It is the only process that opens and refreshes the owner's credential store. The test copy receives access tokens with a maximum 15-minute lease over a private Unix socket. It receives no refresh token and writes no credentials. Leases stop at the session deadline. Four hours is the default and twelve hours is the maximum.

Use a fresh test directory outside the owner's data directory. Existing managed test directories must already contain the new protected core. Bootstrap reuses an existing installed core, so restarting an old test install does not upgrade it.

## Acceptance commands

Run these only after the protected-core review and owner approval. This sequence is documentation. Implementation tests use synthetic data and never execute it against the owner.

First quit any Gaia desktop app. An idle supervisor can still hold locks with no managed child and no listener on 4317. The review observed supervisor 46601 under bootstrap 46599 in this state. Those are historical observations. Read the current lock files rather than reusing those PIDs.

Run this function from the merged checkout. It validates both PIDs before signalling the supervisor. A missing lock, a dead PID or a command from another install stops the function. A failed function returns to your shell, without closing the terminal.

```sh
cd /Users/avi/Developer/vibe/gaia
owner_data=/Users/avi/Developer/vibe/gaia/data
gaia_stop_owner() {
  if [[ ! -r "$owner_data/control/supervisor.lock" || ! -r "$owner_data/control/bootstrap.lock" ]]; then
    echo 'A lock is missing. Stop and inspect the managed processes before continuing.'
    return 1
  fi
  gaia_supervisor=$(cat "$owner_data/control/supervisor.lock")
  gaia_bootstrap=$(cat "$owner_data/control/bootstrap.lock")
  if [[ ! "$gaia_supervisor" =~ ^[1-9][0-9]*$ || ! "$gaia_bootstrap" =~ ^[1-9][0-9]*$ ]]; then
    echo 'Invalid lock PID. Stop and inspect the control records.'
    return 1
  fi
  gaia_supervisor_args=$(ps -ww -p "$gaia_supervisor" -o command=)
  gaia_bootstrap_args=$(ps -ww -p "$gaia_bootstrap" -o command=)
  gaia_bootstrap_cwd=$(lsof -a -p "$gaia_bootstrap" -d cwd -Fn | sed -n 's/^n//p')
  if [[ "$gaia_supervisor_args" != *"$owner_data/protected/"*"/core/main.ts"* || "$gaia_supervisor_args" != *"--installed"* || "$gaia_bootstrap_args" != *"core/main.ts"* || "$gaia_bootstrap_args" == *"--installed"* || "$gaia_bootstrap_cwd" != /Users/avi/Developer/vibe/gaia ]]; then
    echo 'The lock holders are not the expected main processes. Stop here.'
    return 1
  fi
  ps -ww -p "$gaia_supervisor,$gaia_bootstrap" -o pid=,ppid=,command=
  kill -TERM "$gaia_supervisor"
  for attempt in $(seq 1 30); do
    if ! kill -0 "$gaia_supervisor" 2>/dev/null && ! kill -0 "$gaia_bootstrap" 2>/dev/null && [[ ! -e "$owner_data/control/supervisor.lock" && ! -e "$owner_data/control/bootstrap.lock" ]]; then
      echo 'Supervisor and bootstrap exited and released their locks.'
      return 0
    fi
    sleep 1
  done
  echo 'Shutdown is incomplete. Do not start the broker. Follow the stuck-supervisor steps below.'
  return 1
}
gaia_stop_owner
```

The bootstrap removes its own lock after the supervisor exits. Wait for both, rather than starting the broker as soon as the supervisor disappears. If the function reports an error, do not continue to the broker command.

### Stop a stuck supervisor

Keep these steps in the same terminal. Do not send signals to a PID whose current command no longer matches the verified install. If either PID has been reused, stop and inspect it rather than signalling it.

1. Recheck the commands and the bootstrap's working directory. Send SIGINT to the same verified supervisor, then SIGTERM to its verified bootstrap if it is still alive. Wait another 30 seconds. These are clean shutdown requests.

   ```sh
   ps -ww -p "$gaia_supervisor,$gaia_bootstrap" -o pid=,ppid=,command=
   lsof -a -p "$gaia_bootstrap" -d cwd -Fn
   kill -0 "$gaia_supervisor" 2>/dev/null && kill -INT "$gaia_supervisor"
   kill -0 "$gaia_bootstrap" 2>/dev/null && kill -TERM "$gaia_bootstrap"
   sleep 30
   ```

2. If either still will not exit, prove there is no managed child before escalating. This command must print no child rows. Its pattern requires a `node` child command, so it excludes the inspection command itself. The listener check must also print no rows.

   ```sh
   ps -ww -axo pid=,command= | awk '$2 ~ /node$/ && index($0, "--managed-child=/Users/avi/Developer/vibe/gaia/data") {print}'
   lsof -nP -iTCP:4317 -sTCP:LISTEN
   ps -ww -p "$gaia_supervisor,$gaia_bootstrap" -o pid=,ppid=,command=
   ```

   If a child or listener exists, stop here and report its PID. Do not force-kill a process that might be refreshing credentials. The supervisor and bootstrap themselves never open the credential store. Once there is no managed child, a stuck supervisor can be escalated without interrupting a credential refresh.

3. Only after the no-child and no-listener checks, and a fresh identity check, send SIGKILL to the verified stuck supervisor. Give the bootstrap another 30 seconds to reap it and remove `bootstrap.lock`. If the bootstrap also remains stuck, recheck its identity and working directory again before sending it SIGKILL too.

   ```sh
   kill -KILL "$gaia_supervisor"
   sleep 30
   ps -ww -p "$gaia_bootstrap" -o pid=,ppid=,command=
   lsof -a -p "$gaia_bootstrap" -d cwd -Fn
   # Only if this is still the verified stuck bootstrap:
   kill -KILL "$gaia_bootstrap"
   ```

4. Confirm both recorded PIDs are gone, there is no managed child and 4317 has no listener. A clean shutdown removes both locks. SIGKILL may leave stale locks, which the broker's existing owner-lock helper reclaims after verifying their holders are dead. Do not delete or edit lock files, SQLite files or anything under `credentials/` by hand.

After merge, Git replaces the old ignored fixture with the committed refusal. Check its first line. It must start with `throw new Error`:

```sh
head -1 data/verification/four-profiles/live-fixture.ts
```

Run the broker from the reviewed source checkout. It must contain this implementation and its dependencies. The installed owner core is not replaced. Merging updates the checkout bootstrap used by the next `start:managed`; it remains inert without `--plan-lease`. The owner runtime stays stopped during the lease.

```sh
cd /Users/avi/Developer/vibe/gaia
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

After every run, press Ctrl-C once and wait for cleanup, including any refresh already in flight. Further SIGINT, SIGTERM or SIGHUP signals during cleanup print `Finishing up. Please wait.` and do not interrupt it. SIGHUP requests a graceful SIGTERM shutdown of the test copy. Record `Leases granted: N` and `Lease tokens found in test data: none`. If files are named, retain them privately and investigate. Do not print their contents. The scan is best-effort and matches exact bytes only. It skips `dependencies/` and symbolic links, and can miss encoded tokens or SQLite overflow-page splits. `none` is a tripwire result, not proof that no token was saved. `Lease token scan failed` means the scan was incomplete; the broker still reports its lease count.

Once the broker exits and releases the locks, restart the owner's existing install using its usual managed command, without `--plan-lease`, and check its connection. This does not install the new core into the owner runtime.

```sh
cd /Users/avi/Developer/vibe/gaia
GAIA_DATA_DIR=/Users/avi/Developer/vibe/gaia/data \
  GAIA_HOST=127.0.0.1 GAIA_PORT=4317 npm run start:managed
```

## Failure and access limits

A missing broker, wrong key, expired session or invalid reply fails closed. The lease store throws `The owner's plan is not available to this test copy.` Pi wraps this as an auth failure. The existing chat error stays plain. There is no retry loop, API key fallback, Pi refresh in the child or boot failure into safe mode.

This protects against accidental credential writes and double refresh. It does not isolate malicious code running as the same macOS user. Editable server code could read or write the owner's files directly. Disabling machine tools removes the easiest accidental path. Only a separate operating-system user would close that boundary.

The installed main and child delete the lease key from `process.env` before editable server code loads. This is not a same-user secrecy boundary. On macOS, same-user `ps -wwE -p <pid>` can still expose each process's original environment, including the key. The bootstrap keeps it in `process.env` too. Do not capture `ps -E` output in acceptance reports.

Both socket deadlines remain five seconds, while Pi allows up to fifteen seconds for refresh. A slow refresh can therefore save its rotated credential safely while the lease request fails. Record this cause if a model or critic call fails during a slow refresh. A critic reported as unavailable still fails acceptance. Providers must return more than twenty minutes of validity after refresh. Shorter-lived credentials are refused, and another request can trigger another refresh. There is no added cooldown or retry loop.

An upstream bearer token can remain usable until its provider-set expiry, even after its local lease ends. The broker cannot revoke it early. Test calls consume the owner's plan usage. The broker can refresh the owner's stored credential while Gaia is stopped. Gaia uses that updated credential when restarted.

The retired `data/verification/four-profiles/live-fixture.ts` contains only a refusal. Git history retains its old body. Merging replaces the owner checkout's ignored copy, so no separate copy step is needed. Its direct read-write owner-store pattern must never be used again.

## Locked spec proposal

Proposed addition under plan sign-in, subject to the owner's separate decision. `SPEC.md` is unchanged:

> A verification-only plan lease lets an isolated test copy use the owner's plan while the owner's Gaia is stopped. It is off unless the owner starts it by hand.
