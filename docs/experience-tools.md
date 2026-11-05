# Experience tool host handover

This adds tools for the profile runtime without changing the existing runtime, protected core, auth, SDK, renderer or dependencies. The parent owns integration and live acceptance. The implementation is the commit containing this handover, based on `de293bfab3f4b362c6b99ab58c10a8ff14bddd49`.

## Inject one host into the runtime

Import `createExperienceToolHost` and `ToolBinding` from `apps/server/experience-tools/index.ts`. Await the factory once per stable server, before admitting jobs. Share that host across every profile. Do not construct a host per job or profile, because the host owns the desktop lease and invocation drain barrier.

```ts
const host = await createExperienceToolHost({
  receiptDirectory: join(generationDirectory, 'experience-tool-receipts'),
  generation: generationId,
  mode: () => currentRuntimeMode,
  enabled: () => machineDispatchEnabled,
  onReceipt: async (receipt) => projectReceiptIntoOwningJob(receipt),
});

const extension = host.extension({
  profileId,
  scopeId,
  jobId,
  generation: generationId,
  conversationId: conversation.id,
});
registry.install(extension);
await conversation.configure({ extensions: [extension] }, context);
```

The snippet's runtime variables and `projectReceiptIntoOwningJob` are caller responsibilities. Pi conversation IDs and task IDs are nominal numbers in installed Pi 1.5.0. Protocol profile, scope and job IDs are UUID strings. Install the extension before submitting the job. Select exactly the bound extension for that conversation. Each extension has a unique name containing its job UUID. Never share its binding with another conversation or job. No mutable current-turn variable is used.

The factory options require `receiptDirectory`, `generation` and `mode`. Mode accepts a fixed value or a callback returning the current `stable`, `candidate`, `probe` or `safe` state. The managed caller maps checking, switching and probing to `candidate` and reads current protected state for dispatch. A successfully probed child can therefore become stable without replacing its host. The enabled callback defaults to false. Stable mode plus the callback enables search. Machine and desktop dispatch additionally require macOS. Candidate, probe and safe modes expose no capability. A parent must pass the real launcher mode, gate and generation. An optional `desktopExecutable` selects a trusted installed CLI path. `platform` is an explicit platform seam for owned tests; production should omit it.

`host.capabilities()` returns machine, desktop, search and selfModification flags. Self-modification is always false here. `host.activeInvocationCount` includes queued desktop work. `host.receipts()` returns detached receipt snapshots. `await host.quiesce()` closes admission, cancels all active work and waits for settlement. It refuses a clean shutdown if native termination remains unverified, including a failed call that already left the active map. `close()` is the same irreversible barrier. Integrators must call it before closing Pi or snapshotting a generation. A disabled gate is checked again after lease acquisition and immediately before dispatch. Disabling the callback alone does not stop an already running process; use quiesce for joined shutdown.

## Model tools and activity

All three ordinary Pi tools use `replay: 'unsafe'`. Every call requires model-written `activity` text of 1 to 160 characters. Pi running details carry identity, description, kind and the real running stage. Desktop waiters do not claim to be running before acquiring the lease. The result or Pi error settles the activity. The parent projects these details into protocol Activity records and clears them on terminal task states. It must not show raw argv as the quiet activity text.

`mac_shell` takes `activity`, `executable`, `args`, absolute `cwd` and optional `timeoutMs` (default 60 seconds, maximum five minutes). It runs structured argv directly. Explicit `/bin/zsh` with `['-c', script]` gives unrestricted shell syntax. It returns stdout, stderr, exit code, signal, reason and truncation. The combined retained process output is bounded to 48 KB. Processes receive only PATH, HOME, USER, LOGNAME, TMPDIR, LANG, LC_ALL and SHELL. HOME, USER and LOGNAME come from the actual operating-system account, rather than the managed service's isolated HOME. OAuth, control, probe and Node injection environment variables are not inherited.

`agent_desktop` takes `activity`, structured CLI `args`, absolute `cwd` and the same deadline. It runs the installed CLI under one FIFO desktop lease across profiles. Cancelling a waiter removes its opportunity to execute. The lease remains held until its process group has joined, so an old process cannot deliver input after reassignment. CLI JSON and diagnostics remain model-visible. A base64 PNG in the documented `data` response, or a nested base64 field, becomes an actual Pi image block. Screenshot calls must omit PATH. A path-only screenshot is still only a path, so the model is instructed to use the CLI's base64 mode. Output is bounded to 12 MB. Invalid JSON, CLI errors and permission failures are error results, not successful actions.

Harmless discovery on the installed CLI established CLI version 1.0.2 on aarch64 macOS, version 2.5 JSON envelopes, `screenshot [PATH]`, base64 `data` without PATH and `status` capability/permission JSON. `capabilities` is not a supported command. No status query, screenshot or operation against the owner's apps was run. Native permissions and the exact live screenshot response remain parent acceptance items. The tests use an owned executable returning synthetic PNG bytes to prove model image transport, not native screenshot correctness.

`search_web` takes `activity` and `query`. It resolves `api.agent(context)` and uses that agent's actual openai-codex model and thinking level through `api.models.completeSimple`. It uses the Pi Context abort signal joined with host cancellation, SSE transport and no automatic request retry. It preserves the assembled payload and existing include values, then injects hosted web search, required tool choice and sources inclusion. Existing Models request transforms remain in the Pi dispatch path. It observes raw provider events before normalisation, including final response output. Success requires a completed hosted `search` action with a valid action shape. Text and Markdown source links are returned alongside JSON evidence. Captured actions, citations and text are bounded. A model answer with no actual completed hosted search fails.

## Receipts and uncertain outcomes

Each invocation is identified by generation, profile, scope, job, Pi conversation, call and task. Replay deduplication keys omit the Pi task ID so allocating a new task does not repeat the same job call. Receipt files use hashes of identities, private file permissions, atomic rename, file sync and directory sync. An intent is persisted before any dispatch. A terminal receipt includes the actual bounded result. The parent should use `onReceipt` to update its job projection, while these files remain authoritative. The callback must not re-enter host close from inside an invocation. Only one host may own a receipt directory at a time.

On reopening a receipt directory, remaining intents become `unknown`. They mean the external effect may have happened. The host rejects duplicate invocations even after a terminal failure. A retry must be a newly admitted attempt with a new job identity and explicit owner handling of uncertain effects. It must never be an automatic recovery replay. A timeout or cancellation receipt proves process-group termination, not that an earlier file write, remote request or click was undone. Read actual external state before deciding whether to repeat it.

The guardian is an independent Node process with its own IPC channel. It starts a detached process group, reports its identity, enforces the deadline and kills that group on cancellation or owner IPC loss. It kills remaining descendants when the immediate executable exits and joins live group members before returning its receipt. Dead zombies are excluded from the join. If the guardian fails, its owner kills and joins the recorded process group before reporting an unknown external outcome. Missing identity or failed fallback termination blocks a clean host shutdown and future desktop handoff. Independent owner-side deadlines bound an unresponsive guardian. An unknown external effect and an unjoined process are distinct states.

Test cleanup targets only owned fixture processes. In protected candidate checks, an owned short-lived child first probes signal permission. Process-lifecycle tests report an explicit skip when that sandbox denies signalling. The ordinary full suite must run these tests without skips.

Provider `url_citation` annotations supply the citation list. Retrieved search-result URLs remain in action evidence and cannot displace the pages actually cited in the answer.

Full owner-level shell access is the accepted same-user trust boundary. Environment filtering avoids accidental credential inheritance. It does not prevent an unrestricted command from reading same-user files, accessing credentials, killing the guardian or deliberately escaping a process group with a new session. This is process lifetime management for cooperating tools, not malicious-code isolation. No shell HTTP route, renderer Node integration, command denylist or approval prompt is added.

## Verification and limits

The feature checkpoint kept installed-API discovery first. Search, process supervision and desktop lease modules have separate responsibilities. Only the desktop cursor invariant is serialised; shell and provider work remain independent. One implementation owner handled the bounded diff. Parallel architecture exploration and child delegation were skipped because the assigned brief forbids child agents. Model the Domain shaped immutable job bindings, a FIFO lease and durable invocation states. Type System Discipline shaped validated provider and CLI boundaries.

The committed tests are discoverable through the existing `apps/server/*.test.ts` glob. They cover actual subprocess success, non-zero exit, bounded output, timeout, cancellation, descendants and owner SIGKILL; queued desktop cancellation; a real Pi Harness tool invocation, receipt identity, dynamic gating, duplicate rejection and image blocks; interrupted-intent recovery; and the installed Codex SSE adapter with mocked transport, byte-split Unicode, final-response evidence, citation bounds, malformed and absent searches, abort and fresh retry evidence.

Repository checks run successfully before the implementation commit were `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npm test`, `npm run build`, `npm run check:protocol` and `git diff --check`. The full suite reported 177 tests, with 176 passed, zero failed and one existing opt-in proof skipped. All nine new tests ran and passed in the ordinary suite. The build retained existing use-client, sourcemap and chunk-size warnings. The final full-suite log is `/tmp/gaia-c9a88fcd-final-tests.log`; build output is `/tmp/gaia-c9a88fcd-build.log`. No live provider call, live owner data inspection, native desktop operation, reserved-port service, push, deployment or protected-core change is part of this implementation. Parent acceptance must prove subscription search and native interaction after runtime injection. Model-specific search availability remains a provider acceptance question, not a capability claim derived from local fixtures.
