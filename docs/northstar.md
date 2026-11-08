# North star

Locked by Avi on 8 November 2026: "This was the exact idea of Gaia. Exact north star. Lock this one in."

## The reference

[GabiDev98 on X, 7 Nov 2026](https://x.com/GabiDev98/status/2119060310384365669): "No dashboards. No tabs. No filters. Smart search bar with intent-based UI for Aave V4. OpenAI Decisions API reads the intent and builds the view."

A local copy of the 66-second video and its frames is kept in `data/northstar/gabidev98-2119060310384365669/` (gitignored). Six key frames are committed in `docs/northstar/`.

## What it shows

- **One input, nothing else.** A single centred bar on a dark page, under one line: "Markets, rates, networks and wallets. The view builds itself." No sidebar, no tabs, no filters. ([01-intent-bar.jpg](northstar/01-intent-bar.jpg))
- **Typed suggestions while you write.** Completions appear under the bar, each tagged with what it is: ASSET, SPOKE or ASK, with the source on the right.
- **Intent becomes a view.** Typing "NVDAc on Base" builds a compact card under the bar with exactly what that asset needs: title and identity, stat tiles, a capacity ring, collateral icons. ([02-asset-view.jpg](northstar/02-asset-view.jpg))
- **Refining reshapes the same card.** Adding ", earnings" turns it into EPS, P/E, next earnings and a bar chart with Revenue, Gross profit and other tabs. ", top depositors" turns it into a table. The card stays in place and changes shape. ([03-refined-earnings.jpg](northstar/03-refined-earnings.jpg))
- **The view fits the question.** "portfolio 0x..." gives net balance, net APY and a health-factor slider with its risk explained. "my positions" gives supplying and borrowing tables. "my earned $ last month" gives a daily bar chart with interest, rewards and borrow cost. ([04-portfolio.jpg](northstar/04-portfolio.jpg), [05-positions.jpg](northstar/05-positions.jpg))
- **Live and continuous.** An earnings counter ticks digit by digit. Charts fill in. Nothing jumps; the card morphs from one state to the next. ([06-earnings-live.jpg](northstar/06-earnings-live.jpg))
- **Calm craft.** Dark surfaces, one purple accent, green and amber only for meaning, quiet type, generous radius, tiles and tables that look designed rather than generated.

## Companion craft references

Small web primitives by Lochie Axon that make transitions and waits feel continuous:

- [Skullet](https://skullet.lochie.me) ([source](https://github.com/lochie/skullet)): smart skeletons. It renders sample data invisibly, measures each element and draws a skeleton in that exact shape while content loads. "Loading states are the first thing people see."
- [Torph](https://torph.lochie.me) ([source](https://github.com/lochie/torph)): dependency-free text morphing, "text continuity for interfaces on the web". Labels and numbers morph into their next value instead of swapping.
- [WebHaptics](https://haptics.lochie.me): haptic feedback for the mobile web.

## What this means for Gaia

The owner states an intent in plain words, and Gaia builds the view for it, in place, at the quality of a hand-designed product. The conversation is the input; the interface is the answer. Gaia's self-made UI work (DESIGN.md, the shared kit, the rendered checks and the visual self-review) is the quality floor that makes this possible. The product implications and any SPEC changes are drafted separately for the owner to approve.
