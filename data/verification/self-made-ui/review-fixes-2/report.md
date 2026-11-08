# Core re-review fixes, second pass

Base: 9a8f112. Owner runtime and auth paths are out of scope. All runtime fixtures use temporary data under /private/tmp, never the owner's data or port 4317.

## Automatic preview

Automatic promotion previews are advisory. A failure records a redacted `preview images unavailable` check and continues without a preview hash. The recipe then renders every persisted surface with its default unlimited overall deadline. Interactive preview keeps its 900-second deadline.

`1-red.log` reproduces the rejected Revert before the fix. `1-checks.log` records both typechecks, lint and 5 focused tests passing, with no skips. The regression invokes the actual supervisor Revert construction and promotion and the actual recipe. It has 12 on-disk surface manifests. It injects timeout and renderer failures, sandbox command results and lifecycle operations. Passing full renders promote with zero failures; a bad full render rejects and increments failures once. This is deterministic decision-path proof, not a real 15-minute renderer timing measurement. Real renderer and sandbox coverage comes from the final suite.
