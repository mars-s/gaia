# Capture v2

Approved scope, 6 November 2026. The extended set makes the measure stricter.

The existing 25 captures keep their journey, dimensions, theme, content and ordering. J5, J8account, J8setups, J10 and J11 each gain 1000 dark, 320 light and 320 dark variants. The total is 40 PNGs. Desktop remains 1000 by 760 CSS pixels and narrow remains 320 by 700.

J1 uses the merged welcome screen with matching ChatGPT and Claude buttons. No fake sign-in state is added. Its description now names both plans. The account description names both plan rows. The manifest records captureVersion 2.

The merged provider filter requires an explicit availability hook in the existing faux-provider fixture. It exposes only the faux ChatGPT provider, and no connected plan for J1. Seeded messages, proposals, model catalogue and attachment content are unchanged. No owner credential store is opened or initialised.

The Electron bootstrap is unchanged. Windows remain hidden and unfocused, background throttling is disabled, the activation policy prohibits a Dock icon and no Agent Desktop command runs. The isolated server uses port 4337. The owner runtime and credentials on 4317 are outside this work.

Round 11m is captured from the committed v2 implementation. Every PNG must be inspected before judging. Its verdict remains pending judge. Rubric and all frozen hooks remain unchanged.

## h3

Claude authorised this minimal J8 navigation revision on 6 November 2026. Real Settings panes replace the long page, so the previous all-five-headings assertion and scroll-to-Setups hook cannot describe owner navigation.

Diff: J8 opens Settings and waits for Account plus the desktop navigation or narrow section picker. J8account stays on Account. J8setups clicks Setups in the desktop navigation, or opens the compact picker and chooses its Setups option at 320 px, then waits for the Setups heading. The existing no-Created assertion moves to the selected Setups pane. The all-five-headings assertion is removed. All other journeys, assertions, dimensions, themes, ordering, background bootstrap and seeded content are unchanged. The exact patch is in the h3 commit for capture.ts.
