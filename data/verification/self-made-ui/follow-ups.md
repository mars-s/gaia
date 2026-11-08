# Deferred core re-review findings

Source: core-rereview.md, Claude Opus 5.5, 8 November 2026. These are follow-ups, not blockers for this upgrade.

- Authenticate control-socket critic results. Accepted app code can read GAIA_CONTROL_SOCKET and send a review command. Model tool calls are blocked, but the socket itself has no authentication. The critique remains advisory and cannot approve or block promotion. Consider a one-time nonce held by the core tool, while recognising that sharing the child process limits its protection.
- Restrict the render sandbox's mach-service access. The current unrestricted `(allow mach-lookup)` is broader than necessary. Measure the services Electron actually needs and use a tested allow-list without breaking hidden rendering.
- Make history parsing resilient across schema changes. Boot strictly parses Change and nested preview, surfaces and critique records. The existing fresh-to-advisory migration demonstrates how an otherwise valid old history could prevent boot. Define explicit versioned migrations or a tolerant historical record boundary.
- Measure a supported surface count and render cost. With N declared surfaces, an uncached before/after preview runs 10 + 2N scenarios, with 16 pages per surface scenario. Do not impose an arbitrary cap without timing evidence. Automatic preview failure now falls through to the full gate, but interactive preview still has its 15-minute budget.
- Keep the watchdog active during promotion checks. The busy flag currently pauses it throughout typecheck, tests, build and rendering while the old child is still serving. Separate checking from switching, with crash and concurrency tests.
- Remove rejected, rolled-back and interrupted staging worktrees. Discard currently provides the only cleanup. Each retained stage costs about 3.7 MB of source plus 1.7 MB of build output. Preserve useful failure evidence before applying a retention policy.
- Prevent candidate JSX from hiding outside-change evidence with data-preview-surface. Use an unpredictable per-render attribute injected by the trusted transform. This affects advisory screenshot evidence, not the promotion gate.
- Add protected-path regressions for find edits through a symlinked folder and case-variant protected paths. Both are currently refused, but explicit tests are absent.
- Keep critic design answers in core for this upgrade, as the review recommends. If they change frequently, consider moving only policy text to a protected non-core file while retaining the runner and JSON contract in core.
