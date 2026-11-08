# Core re-review fixes, second pass

Base: 9a8f112. Owner runtime and auth paths are out of scope. All runtime fixtures use temporary data under /private/tmp, never the owner's data or port 4317.

## Automatic preview

Automatic promotion previews are advisory. A failure records a redacted `preview images unavailable` check and continues without a preview hash. The recipe then renders every persisted surface with its default unlimited overall deadline. Interactive preview keeps its 900-second deadline.

`1-red.log` reproduces the rejected Revert before the fix. `1-checks.log` records both typechecks, lint and 5 focused tests passing, with no skips. The regression invokes the actual supervisor Revert construction and promotion and the actual recipe. It has 12 on-disk surface manifests. It injects timeout and renderer failures, sandbox command results and lifecycle operations. Passing full renders promote with zero failures; a bad full render rejects and increments failures once. This is deterministic decision-path proof, not a real 15-minute renderer timing measurement. Real renderer and sandbox coverage comes from the final suite.

## Test skip receipts

The trusted recipe requests Node's TAP reporter and reads its final skip total. Receipts include `(N skipped)` when non-zero. A missing summary fails the check rather than implying complete coverage. Candidate test failures still block before build.

`2-red.log` shows a real sandbox recipe with three skipped native fixtures reporting only `unit tests: passed`. `2-checks.log` records both typechecks, lint and 3 focused tests passing, no outer-suite skips. The real recipe fixture now verifies `unit tests: passed (3 skipped)` before its intentional design-pack failure. The deterministic promotion fixture supplies a zero-skip TAP summary.

## Dead input cleanup

Removed preview-command surfaces, previewChange's overwritten argument, recipe's overwritten option, and their callers. Surface declarations in stored preview history remain for compatibility. Unknown legacy command fields are stripped at the existing Zod boundary, so they cannot override manifests. Dropped the core tool description's claim about app-managed automatic pack attachment; the app still owns that behaviour. Kept critic policy text as the review recommends.

`3-red.log` shows both the unwanted default surfaces field and the stale app-behaviour promise before cleanup. `3-checks.log` records both typechecks, lint and 17 focused tests passing, no skips. The dedicated input test replaces obsolete validation assertions against the removed field; persisted manifest validation remains covered by surfaces.test.ts.

Deferred findings and reasoning are in ../follow-ups.md. Final build, protocol, load and full-suite logs will be saved beside this report after this commit, so the full suite runs on the final code HEAD. Final verification results are recorded in final-report.md. These final-run artefacts remain local to avoid changing the HEAD they verify.
