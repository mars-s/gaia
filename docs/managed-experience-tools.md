# Profile jobs and local tools

The normal managed child enables isolated experience profiles and supplies one shared tool host to Original chat and every profile worker. Each worker selects its own immutable tool binding. Original chat uses reserved internal profile and scope identities ending in `0001` and `0002`, its actual Pi conversation ID and the admitted request UUID. These identities describe tool receipts and do not create profiles or replace the original thread.

The development server also enables profiles and the shared host. It has no supervisor or `self_change` capability. Managed instances explicitly supply the existing `self_change` extension to profile jobs. App source changes retain the trusted source-change pipeline. Machine tools perform ordinary owner tasks with the already accepted same-user access.

## Dispatch and shutdown

`core/machine-gate.ts` reads and validates the current protected manifest for each capability or dispatch check. Only a stable manifest with the child's exact release and generation enables tools. Checking, switching, probing, a foreign pair and an unreadable manifest disable dispatch. Probation can become stable without restarting the child. Safe mode and isolated probes do not construct a tool host or expose profile execution.

The tool host is shared across profiles, so desktop work shares one cursor lease. Shell and provider work remain independent. `createPi.close()` joins profile quiescence and host quiescence before closing the profile stores and the original Pi store. The protected child still requires whole-runtime closure before sending its exact-generation shutdown receipt.

Host receipts are stored under the conversation generation's `tool-receipts` directory. A refused call before dispatch has a known failure receipt. The profile wrapper records that result without labelling it an uncertain external effect. Arbitrary external tool exceptions remain uncertain. Cancellation can also leave a profile invocation uncertain when Pi has already aborted its task before its result can be committed, even though the host receipt proves that the process group stopped. This is conservative about prior effects. Stopping a process does not undo earlier writes, requests or input. Retrying an uncertain job requires explicit confirmation and a new attempt.

Search uses the existing Pi model and OAuth capability. Profile stores reuse that capability and never copy credentials. Environment filtering and guardians manage cooperating processes. They are not a malicious-code boundary against unrestricted same-user commands.

## Verification and activation

The integration tests run two real structured-argv commands in separate profile jobs and a real command from Original chat. They inspect actual output and job-bound receipts, change a live capability gate and prove that quiesce returns only after an owned command has exited. An installed-child test uses real Pi with a faux provider, verifies actual offered tools, current managed gating, whole-profile shutdown, zero-provider-call restart and plain safe mode with unchanged original messages. The same profile test fails against the previous launcher.

These tests do not prove subscription search, actual Agent Desktop input or the rendered native UI. Those remain separate acceptance work. Run the complete repository gates before committing. Activate only a committed, reviewed owner upgrade after comparing its exact changed protected file inventory. The current owner service is not changed merely by merging these sources.
