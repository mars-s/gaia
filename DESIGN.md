# Gaia client design

The client follows [SPEC.md](SPEC.md). These rules describe the shared design used by the hand-built UI and new surfaces. The Pi subscription backend stays in place. Prefer Base UI for new primitives under the spec’s library policy.

1. **Feel and three principles.** A quiet notebook that talks back. (1) One conversation, one surface. (2) Emphasis is earned by the primary action. (3) Same thing, same look, everywhere.
2. **Tokens.** Only semantic tokens in product CSS. Primitive ramps live only in token files.
   - Colour roles: `--color-surface-page`, `--color-surface-raised`, `--color-surface-sunken`, `--color-surface-hover`, `--color-surface-selected`; `--color-line`, `--color-line-strong`; `--color-ink`, `--color-ink-2`, `--color-ink-3`; `--color-accent`, `--color-accent-strong`, `--color-accent-soft`; `--color-primary-fill`, `--color-primary-ink`; `--color-link`, `--color-link-hover`; `--color-danger`, `--color-danger-soft`; `--color-focus`. Light page white, dark page `#121212`.
   - Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64. Named: gutter 24 (16 below 640), message gap 24, turn gap 32, row 8 by 10, bubble 10 by 16, composer bottom 24.
   - Radii: xs 4, sm 8, md 12, lg 16, bubble 20, composer 24, full.
   - Motion: hover 150 ms ease, popover 150 ms ease-out, exit 120 ms ease-in, card 200 ms ease-out, drawer 240 ms, pulse 1800 ms. Respect reduced motion.
   - Focus: 2 px `--color-focus` outline, 2 px offset, visible in both themes.
   - Text inks reach 4.5:1 against their supported surfaces in both themes. Focus reaches 3:1 against every surface. Hairline and control-border tokens are exempt. Never rely on a border alone to identify a control.
3. **The three button styles** (plus two non-buttons).
   - Primary (`primary-action`): `--color-primary-fill` with white ink, AA in both themes. At most one per surface. It is the one thing the owner most likely does next.
   - Secondary (`secondary-action`): raised surface, hairline, ink text. For every other real action, including "Open" in lists.
   - Quiet (`quiet-action`): text only, `--color-ink-2`, zero inline padding so text sits on the column edge, 36 px hit area. For "Not now", "Refresh", creation rows.
   - Not buttons: inline link (`inline-link`, prose only) and icon button (36 px, bare at rest, 20 px glyph, needs an accessible name).
   - Sizes: small 32, default 36, large 44 (welcome only). Radius sm.
   - Destructive: secondary style with danger text, separated from its neighbour by at least 16 px, never bare red text beside a button.
4. **Grid.** Reading column text 680 px, box 728 px, gutters 24 (16 below 640). Sidebar 240 px, padding 12, rows 8 by 10, icon column 24 plus 8 gap, so labels land on one edge. Every text in the main area starts on the column's text edge (L); trailing controls end on R. Title bar 52 px, one row at every width.
5. **Type scale.** System sans; weights 400, 500, 600 only. hero 20/28 600; section 16/22 600; message 15/24; ui 14/20 (500 for labels and selected rows); label 13/18; caption 12/16; code 13/20 mono.
6. **Shared parts.** Reuse these compositions. The kit at `apps/web/ui/` collects them for new surfaces.

   | Part | Source | Example |
   | --- | --- | --- |
   | Status pill, neutral or accent | [status-pill.tsx](apps/web/status-pill.tsx) | `<StatusPill tone="accent">Main chat</StatusPill>` |
   | Proposal card, full or compact | [proposal-card.tsx](apps/web/proposal-card.tsx) | `<ProposalCardContent compact title="About you" status="Optional" body="Fit Gaia around your work." primary="Start" onAccept={start} onDismiss={dismiss} />` |
   | Row with icon column | [experiences/index.tsx](apps/web/experiences/index.tsx) | `setup-list-row` with `setup-row-meta` and `setup-row-actions` |
   | Assistant turn head | [assistant-head.tsx](apps/web/assistant-head.tsx) | `<AssistantHead name="Gaia" />` |
   | Notice line | [progress-row.tsx](apps/web/progress-row.tsx) | `<ReplyNotice message="Connection lost." onRetry={retry} />` |
   | Empty composition | [empty-chat.tsx](apps/web/empty-chat.tsx) | `<EmptyChat onStarter={send} />` |
   | Menu | [experiences/index.tsx](apps/web/experiences/index.tsx) | Main chat menu with `Menu.RadioItem` rows |
   | Listbox | [settings-index.tsx](apps/web/settings-index.tsx) | `<SettingsHeading id="setups-title">Setups</SettingsHeading>` |
   | File chip | [image-previews.tsx](apps/web/image-previews.tsx) | `DraftImages` in the shared composer |

7. **States every new surface must have.**
   - Empty: one composition. A glyph or tile, one line in plain words, optionally up to three starters. Centred slightly above the optical centre. No second paragraph.
   - Loading (ordinary surface data, for example a list or pane fetching its contents, not agent work): nothing for the first 300 ms, then the quiet pattern (avatar or tile plus dots) or skeleton rows for lists over a known shape. No words and no labelled spinner for this kind of loading.
   - Agent task progress (work Gaia is doing for the owner) is a different thing and always follows the SPEC.md progress rule: avatar pulse and Stop with no words until real activity exists, then quiet task-specific wording supplied by the agent from real execution; never timers or generic phrases.
   - Error: danger glyph, one plain sentence, the cause only if the system knows it, a secondary "Try again", and a caption second path when one exists.
   - 320 px: 16 px gutters, one title row, no horizontal page scroll, controls drop to a second row rather than shrink, names and actions never truncate, ellipsis only on long free text.
   - Dark: tokens only, so dark comes free. Check every fill against the page; no light box on a dark page.
8. **Copy rules.** Australian English, sentence case, curly apostrophes, no em or en dashes, no exclamation marks. Buttons are verbs ("Open", "Add task"). One name per thing (setup, main chat, Original chat). State the consequence before the click ("This becomes your main chat"). Never invent progress words, causes or features.
9. **Never do.**
   - Accent-coloured text for actions inside a list.
   - A horizontally scrolling tab strip.
   - Layout space reserved for something hidden at rest.
   - `object-fit: contain` on image previews.
   - A second card style, a fifth avatar language, or a new pill shape.
   - A second header or a repeated title.
   - Status that looks like a button.
   - The only way to do something hidden in an overflow menu.
   - Raw colours or raw spacing outside token files.
   - New rules appended to the end of `style.css` to override old ones.
   - Swinging a control to the opposite extreme to answer one complaint.
