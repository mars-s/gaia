# Design pass captures

Run from the Gaia checkout:

```sh
npx tsx data/verification/design-pass/capture.ts --round <n>
```

Choose a fresh round number. A completed round cannot be overwritten. The command builds the current checkout, runs an isolated loopback QA server on **4337**, launches real Electron with the production main entry point and a fresh temporary user profile, and writes 40 PNGs plus `manifest.json` to `rounds/<n>/`. It exits if 4337 is occupied. Run captures serially while the checkout is idle. It does not access owner port 4317 or alter the live acceptance fixture on 4327.

The server follows `four-profiles/native-acceptance/fixture.ts` for serving production web assets and API handlers. Unlike that live provider fixture, it never opens the owner credential store or calls auth initialisation. Fresh QA databases have no credentials. Pi uses its supplied faux provider for the Bots, Channels and Sessions conversations. Plan availability is explicitly limited to that faux ChatGPT provider, with no connected plan for J1. Original chat uses fixed persisted synthetic messages and a scripted held reply. The proposal is bound to its synthetic answer through the real experience runtime. No page markup or CSS is substituted. Each journey starts with fresh QA data and the Electron window is closed afterwards.

The command uses installed Electron in the background, with hidden, unfocused windows, no Dock icon and no `agent-desktop`. It checks native window visibility and focus through Electron. Playwright's Electron driver launches the app and controls its real renderer through CDP. It uses the locally cached `playwright-core` at `/Users/avi/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs`. Set `GAIA_CAPTURE_PLAYWRIGHT` to another installed `playwright-core/index.mjs` if that cache changes. The QA profile and database live under `qa-*` during each journey and are removed on normal completion or renderer failure. No persistent app profile is reused.

Window content sizes are exactly 1000 by 760 or 320 by 700 CSS pixels. PNGs retain the display's native device scale, currently 2x. Theme selection uses Gaia's real `gaia.appearance` preference followed by reload and Electron's native theme source. No CSS theme override is injected. The PNGs capture the real Electron renderer, excluding native title bar decorations, so Stage Manager thumbnails and another app's window cannot enter the set.

The 13 base views include separate shots for Channels and Sessions, and separate account and setups-list shots. Capture v2 retains all 25 existing captures and adds dark desktop, light narrow and dark narrow variants for J5, J8account, J8setups, J10 and J11. J2, J4, J6 and J9 retain those same variants. J1 naturally shows both product sign-in buttons. See `capture-v2.md` for the extension. The manifest marks `captureVersion: 2` and records each view's sentence, CSS size, theme, pixel hash and visible text, plus git HEAD and dirty status. An unrelated untracked `.claude/` directory means the current baseline tree is dirty. The command checks that HEAD and git status did not change during capture.

Known coverage limits:

- Original chat has no tool activity in its wire protocol. J3 captures the actual quiet progress avatar and Stop reply control. A tool description cannot be added there by this harness without changing the product. It does not pretend to show one.
- J4 uses normal linked sources in Markdown. Original chat has no structured citation metadata. At 320 pixels the answer scrolls naturally to its end, showing the list, code and sources, with the opening paragraph above the viewport.
- These are deterministic visual fixtures, not live OAuth or provider acceptance tests. J10 is the app's persisted reply-error state, rather than an actual network outage.

Compare two completed runs with Pillow installed:

```sh
python3 data/verification/design-pass/compare.py repeat-a repeat-b
```

This requires identical visible text, identical dimensions and HEAD, a mean channel difference below 0.5 out of 255, and fewer than 0.5% of pixels differing by more than 16. It saves a comparison JSON beside this README. Small differences from the genuine pulsing progress avatar are allowed. Inspect every screenshot before giving it to the judge. The rubric is frozen and must not be edited.
