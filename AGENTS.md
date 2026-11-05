# Guidance for coding agents

For Codex, Sol 6.1 and any other agent working in this repo.

- Read `SPEC.md` first, then `docs/hosting.md`. The spec is locked; propose changes rather than drifting from it.
- The protected core is off limits to self-modification: the watchdog supervisor, rollback logic, safe mode and auth. Keep it small, separate and well tested.
- Work in small, verified steps. One concern per commit.
- Run checks (typecheck, lint, tests) before every commit, and say what you ran.
- Respect the hosting musts: small footprint, one data dir, configurable bind and port, health endpoint, avoid ports 8096, 8264 and 8090.
- For UI work, follow the library policy in `SPEC.md`. Read `.agents/skills/boardui/SKILL.md` when using the installed Board UI components. Keep Gaia's Pi subscription backend.
- Never commit secrets, tokens or credentials.
- Writing style: Australian English, no em dashes.

## pstack

- Use `gpt-6.1-sol` for implementation, code changes, builds, tests and execution. Use Claude Opus 5.5 High and Claude Fable 5.1 High for product direction, north-star critique, architecture, code critique and UI/UX design. Claude returns decisions and implementation briefs; Sol implements and verifies them. Follow [docs/pstack.md](docs/pstack.md) for provider and role details. This replaces the earlier Sol-only and Sonnet review defaults.
- Before starting a task, read the installed `pstack:poteto-mode` skill and [docs/pstack.md](docs/pstack.md). Use the matching playbook, with the project rules above taking precedence.
- This project's master thread coordinates scope, dependencies and results. Give each implementation task a bounded brief and return its changes, checks and remaining issues to the master thread.
