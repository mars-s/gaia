# Guidance for coding agents

For Codex, Sol 6.1 and any other agent working in this repo.

- Read `SPEC.md` first, then `docs/hosting.md`. The spec is locked; propose changes rather than drifting from it.
- The protected core is off limits to self-modification: the watchdog supervisor, rollback logic, safe mode and auth. Keep it small, separate and well tested.
- Work in small, verified steps. One concern per commit.
- Run checks (typecheck, lint, tests) before every commit, and say what you ran.
- Respect the hosting musts: small footprint, one data dir, configurable bind and port, health endpoint, avoid ports 8096, 8264 and 8090.
- No Radix. Use Base UI where a component library is needed; chat is unstyled assistant-ui.
- Never commit secrets, tokens or credentials.
- Writing style: Australian English, no em dashes.
