# Guidance for coding agents

For Codex, Sol 6.1 and any other agent working in this repo.

- Read `SPEC.md` first, then `docs/hosting.md`. The spec is locked; propose changes rather than drifting from it.
- The protected core is off limits to self-modification: the watchdog supervisor, rollback logic, safe mode and auth. Keep it small, separate and well tested.
- Work in small, verified steps. One concern per commit.
- Run checks (typecheck, lint, tests) before every commit, and say what you ran.
- Respect the hosting musts: small footprint, one data dir, configurable bind and port, health endpoint, avoid ports 8096, 8264 and 8090.
- No Radix. Use free MIT-licensed Board UI components with a plain, themeable default. Read `.agents/skills/boardui/SKILL.md` before UI work. Keep Gaia's Pi backend rather than adopting Board UI's API-key chat starter.
- Never commit secrets, tokens or credentials.
- Writing style: Australian English, no em dashes.

## pstack

- Use `gpt-6.1-sol` for all development, planning, review and delegated work on Gaia. Choose reasoning effort to suit the task. Do not use Claude models for project work. This overrides installed skill defaults and global model settings.
- Before starting a task, read the installed `pstack:poteto-mode` skill and [docs/pstack.md](docs/pstack.md). Use the matching playbook, with the project rules above taking precedence.
- This project's master thread coordinates scope, dependencies and results. Give each implementation task a bounded brief and return its changes, checks and remaining issues to the master thread.
