# Gaia client design

The user's corrective brief replaces the previous labelled web form with a minimal, familiar Board UI conversation. This direction is supplied by the task, not a new approval claim.

## Surface

Operate mode. The task is to connect once, then write and read messages. A single 52px title bar shares the page background. On macOS, Electron's real inset traffic lights sit beside the quiet Gaia name. Only connected users see the account control.

Disconnected users see a centred, 320px-wide welcome group. The pending screen contains browser handoff and optional help. Connected users see a conversation up to 768px wide, with a bottom composer and small empty prompt. Account settings replace the conversation temporarily, without an overlay.

## Tokens and type

Use Board UI semantic tokens and `cx()`. The system sans is intentional for a desktop utility. Titles use `text-title-3-semibold`; text and controls use the Board UI body and caption composites.

| Role                            | Light                          | Dark                          |
| ------------------------------- | ------------------------------ | ----------------------------- |
| Page                            | `background-full`, white       | `background-full`, #121212    |
| Composer and user message       | `background-secondary-default` | Same semantic token           |
| Primary text                    | `text-primary`                 | Same semantic token           |
| Supporting text and placeholder | `text-secondary`, neutral-600  | `text-secondary`, neutral-400 |
| Control border                  | `border-button-default`        | Same semantic token           |
| Focus                           | `border-focus-ring`            | Same semantic token           |

Supporting text overrides the upstream faint neutral defaults for readability. Theme follows the system and updates live. The native window background and overlay controls follow the same light and dark backgrounds.

## Composition

No sidebar, decorative graphics, gradients, permanent auth panels or model labels. Board UI's free registry `SocialButton` provides the ChatGPT action, with a Remix icon. `IconButton` provides account, send and stop. The free Board UI `Textarea` grows from one to eight lines inside the composer. The Pro composer and templates are not used.

Messages have 32px separation. User text has a quiet secondary fill and aligns right. Assistant text sits directly on the page. The composer remains available when the transcript scrolls. At 320px, content has 16px side insets. Hover, focus and disabled states use the installed component vocabulary. No authored animation is needed.

## Behaviour

Sign-in opens once for each URL during a flow, including repeated SSE snapshots and StrictMode effect replay. Browser retry is explicit. Manual-code entry stays in a disclosure. Drafts survive failed sends and disconnects. Keyboard send uses the same guard as the button and respects IME composition. Retry appears only with a failed reply. The transcript follows new replies unless the owner scrolls up.

## Verification boundary

Code, unit checks and the mechanical detector support the implementation handoff. They do not establish visual quality or prove default-browser profile selection. The parent owns desktop launch, screenshots, live auth and interaction verification.
