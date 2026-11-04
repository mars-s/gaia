# pstack for Gaia

Use pstack for Gaia work. Skills are installed in `~/.agents/skills/`. Start with `poteto-mode/SKILL.md` and read its `references/codex-tools.md` when running under Codex.

This file supplies project model overrides. Avi chose `gpt-6.1-sol` for all Gaia work on 4 November 2026. This includes planning, implementation, reviews and delegated tasks. These project values take precedence over installed skill defaults and global model settings. Global settings remain unchanged.

```text
feature, refactoring: gpt-6.1-sol
bug-fix: gpt-6.1-sol
perf-issue: gpt-6.1-sol
hillclimb: gpt-6.1-sol
judgment and prose: gpt-6.1-sol
strongest judgment: gpt-6.1-sol
how explorer: gpt-6.1-sol
how explainer: gpt-6.1-sol
why investigators: gpt-6.1-sol
why synthesizer: gpt-6.1-sol
reflect tooling: gpt-6.1-sol
reflect judgment, divergent, synthesizer: gpt-6.1-sol
arena runners: gpt-6.1-sol, gpt-6.1-sol, gpt-6.1-sol
arena cross-judge pool: gpt-6.1-sol, gpt-6.1-sol, gpt-6.1-sol
swarm workers: gpt-6.1-sol
architect runners: gpt-6.1-sol, gpt-6.1-sol, gpt-6.1-sol
interrogate reviewers: gpt-6.1-sol, gpt-6.1-sol, gpt-6.1-sol
```

Choose any supported reasoning effort to suit the task. Use higher effort for difficult design, recovery and concurrency work. Panels keep their configured number of reviewers, all on Sol 6.1; their diversity comes from independent angles and reasoning effort rather than different models. Do not use Claude models for project work. This development policy does not remove Gaia's planned support for Claude subscription sign-in.

For the overnight run starting 5 November 2026, Avi explicitly requested Sonnet 5.5 to critique the spec, north-star alignment and UI. That review role is the authorised exception to the Sol-only defaults above. Implementation remains on Sol 6.1, with high, xhigh or max effort as useful.

In T3 Code, follow the session's orchestration instructions for dispatch, isolation and waiting. Use native subagents for Sol 6.1 when inheriting session settings; use `delegate_task` when separate settings or a separate checkout are needed. Report an unavailable model rather than substituting one silently.

## Coordination

The master thread owns planning, task briefs, integration decisions and the overall progress report. Future delegated tasks belong under that thread. Create separate top-level threads only when Avi requests them.

Each brief names the goal, allowed paths, dependencies, acceptance criteria and verification commands. Give concurrent writers separate checkouts. Reports include the branch and commit, changed behaviour, checks actually run, blockers and any PR link. Read the actual changes and verification evidence before accepting a report.

Use the milestone order in `SPEC.md`. Implementation starts when Avi assigns work. Setting up this coordination thread does not start the milestone programme or authorise deployment.
