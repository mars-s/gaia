# Gaia

<!-- impeccable:product-schema 1 -->

## Platform

web

Gaia's React client also runs in an Electron desktop window.

## Users and purpose

One owner runs an agent on their own machine. The seed begins with a conversation. Additional interfaces grow on request through the server's self-modification pipeline.

## Current workflow

Connect a ChatGPT subscription through the existing Pi OAuth flow. Finish sign-in in the system's default browser, then return to Gaia to chat. The server owns messages, streaming and credentials. The client uses the versioned protocol and SDK.

## Constraints

- `SPEC.md` is the locked product authority. This file describes the current client slice.
- Use free MIT-licensed Board UI components. No Radix or paid templates.
- Keep the existing Pi backend. Do not replace subscription sign-in with API keys.
- The desktop seed opens the configured Gaia web address. It does not yet manage the server, package an installer or expose terminal and file tools.
- The user wants a minimal custom title bar, short onboarding and a conversation without permanent account banners or telemetry.
- Default-browser sign-in must use the owner's existing browser profile. The user's default browser is Helium.

## Voice

Plain Australian English. Short action labels. No em dashes, slogans or unverified claims about where data lives.

## Evidence

The task supplied two Board UI screenshots as visual references for restrained dark surfaces and a compact composer. They do not license Pro template code. Live desktop and sign-in verification belongs to the parent task.
