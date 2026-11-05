# pstack for Gaia

Before project work, read `~/.agents/skills/poteto-mode/SKILL.md` and its `references/codex-tools.md` under Codex. Project instructions and Avi's current role choices take precedence over installed skill defaults. Global model settings stay unchanged.

## Model roles

On 5 November 2026, Avi assigned Claude product and design leadership, with Sol implementing and executing. This supersedes the earlier Sol-only policy and the Sonnet 5.5 review exception.

| Work | Provider and model | Effort |
| --- | --- | --- |
| Product direction, north star and architecture | Claude provider, `claude-opus-5-5` | High |
| UI/UX design, product critique and code critique | Claude provider, `claude-fable-5-1` | High |
| Independent founder/design counterproposal | The other Claude model above | High |
| Implementation, fixes, refactoring and code changes | Codex provider, `gpt-6.1-sol` | High, or higher where useful |
| Builds, tests, app execution and acceptance | Codex provider, `gpt-6.1-sol` | High, or higher where useful |

Opus and Fable act as founders, product managers and designers. Give them concrete source and rendered evidence, ask them to challenge the current approach from first principles, and have them return prioritised decisions with acceptance criteria and bounded Sol briefs. They do not edit application code, run builds or tests, operate the app, or deploy. Sol assesses their recommendations against the owner requirements and evidence, implements accepted changes and verifies the result. Record a specific reason for rejecting or deferring a recommendation.

Use the actual Claude provider so this work uses Avi's Claude allowance. In T3 Code that provider is `claudeAgent`, and the High option is `effort: high`. Codex uses `reasoningEffort`. Discover current availability through the orchestrator when changing providers. Report an unavailable requested model rather than substituting one silently. This development policy is separate from Gaia's own Pi subscription providers.

## Coordination

The master thread owns scope, dependencies, integration and the overall report. Delegates stay under this thread. Create top-level threads only when Avi requests them. Use T3 `delegate_task` for a different provider or a prepared separate checkout. Follow each running task's orchestration instructions and do not poll it before completion.

Each implementation brief names the goal, owned paths, dependencies, acceptance criteria and checks. Give concurrent writers separate prepared checkouts. Reports name exact commits, behaviour, checks actually run and remaining issues. Read the changes and evidence before accepting them.

Keep the product's existing owner data and protected recovery/auth boundaries intact while revising the design. Owner-authorised protected integration uses the checked owner-upgrade path. Product critique may propose spec changes explicitly; Sol records accepted decisions before implementation rather than silently drifting from the locked spec.
