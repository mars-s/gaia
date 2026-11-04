# Local verification, 5 November 2026

This records the local chat and confirmed-workspace increment. It does not claim that every milestone in `SPEC.md` is complete. Runtime implementation was checked at `04022863b8c371830e2a6cf5b92159b190cba269`; this report and the README are documentation-only additions.

## Delivered behaviour

- A minimal Electron chat with dark, light and system appearance. Assistant messages use genuine unstyled assistant-ui and safe Markdown. Raw HTML and remote Markdown images are not rendered.
- Real Pi model capabilities and supported reasoning levels. Equivalent provider levels share one slider stop. Queued selections retain the latest choice and apply to their originating conversation.
- Image picker, clipboard paste and Finder drop, with previews, removal, image-only messages and retry. The server validates and prepares bytes before Pi receives them. Draft text and image bytes persist separately.
- Progressive setup that retains explicit answers and approval preferences. An answered introductory question disappears. Save and Skip require owner actions. Starting setup from an area returns to Home without replacing its draft.
- Reviewed single or multi workspace proposals. Typed agreement alone does not confirm one. Single setup retains one chat. Confirmed multi setup creates separate Pi conversations with separate settings and drafts. Home routing returns the target's actual answer.
- Safe-mode Home chat without area scheduling. Unavailable area reads do not block healthy conversations. Reconnection refreshes areas previously marked running.
- Explicit owner upgrades with committed-source exports, exact reviewed core allowlists, separate complete dependencies and journalled stopped-only recovery. This command does not expose an agent tool or relax self-change restrictions.

## Checks and observed results

The integrated suite passed 167 tests, with one opt-in provisioning proof excluded from the ordinary run. Both typechecks, lint, production build, protocol conformance and diff checks passed. Separate provisioning evidence covers complete npm installation, Electron resolution, dependency reuse, fixed recipe gates and deterministic reboot. The real local owner upgrade also completed its six fixed gates before activation.

Actual macOS interactions covered both themes at 320 px and wider window sizes, model selection, rapid keyboard effort changes, Escape focus, file selection, paste, physical Finder drag, removal, Stop, Retry and explicit confirmation. A controlled failed send retained its draft and image. Scoped drafts survived renderer, Electron and server restarts.

Genuine Sol 6.1 requests described a known image correctly, including image-only input and image retry. A real Home turn routed work to an area and quoted that area's answer. Stopping from the area joined Home and its routed work. Offline inspection of separate Pi contexts confirmed that a private Home marker had not been copied into areas.

Installed protected-child tests used the real Pi adapter with deterministic providers. They cover normal, safe and probe modes, and interrupted ownerless active and deferred work. Reopening makes no provider requests before an explicit action. Separate native checks showed real Home chat working while safe-mode area endpoints refused execution.

Independent Sonnet 5.5 UI/spec review and Sol 6.1 upgrade review found reconnect, unavailable-area and failed-start recovery defects. Follow-up regression tests reproduced the defects before fixes. Native checks then verified the conversation recovery fixes. Failed-start owner restore permits only explicit watchdog-state changes on the same upgraded pair and retains foreign-release guards.

The final managed installation completed a real provider turn, a checked temporary UI promotion and a Revert selected in the native change history. Both automatic renderer reloads retained an unsent text/image draft. All 145 runtime source files matched the original checked source after revert. A full managed restart retained exact conversation history and reconnected the native client. Existing owner history, skipped setup, credentials and SQLite definitions were preserved. Synthetic workspace tests used separate data.

No raw subscription wire payload was captured. Provider metadata, persisted selection, actual replies and installed adapter behaviour provide the effort evidence. The reviews did not themselves operate the app; native observations and regression checks were performed separately. Local screenshots, receipts, review reports and the requirement audit remain under `data/verification/overnight-chat` and are not committed because some artifacts contain owner data.

## Boundaries and next work

This remains a loopback macOS prototype. Claude sign-in, remote pairing, Linux sandboxing, arbitrary machine tools, production hosting, routines, memory adapters and generated clients remain later work.

A confirmed workspace cannot yet be edited or undone. The confirmation card says so. One conversation works at a time. Area conversations have no machine tools, and idle unselected areas use bounded background polling. Server admission remains authoritative if another client races the latest state read.

New draft image rows are reclaimed within their own scope. Legacy migration rows and server attachment files are retained; a general retention policy is not implemented. Stored images may retain metadata when preparation does not need to re-encode them. Large histories still use whole snapshots and projections.

The active and known-good renderers both understand version 3 drafts. An explicit operator restore to an older frontend is a separate compatibility decision; do not delete browser storage to work around an older reader. Operator recovery restores the old conversation generation, so retain newer messages before choosing it after live use.

Protected checks fail closed without the macOS sandbox. Promoted app code still runs as the same user. Dependency readiness checks prove installed versions and executable availability, not cryptographic integrity of every installed byte. See [owner upgrade recovery](owner-upgrades.md) and [managed limits](managed-local.md).
