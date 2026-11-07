# Development design pins

Run `npx tsx --test tests/design-pins/*.test.ts`, `node tests/design-pins/check-inventory.mjs` and `npx tsc --project tests/design-pins/tsconfig.json --noEmit` before committing UI work.
These exact appearance checks stay outside the trusted candidate recipe, which discovers only server and web tests under `apps/`.

`inventory.tsv` records each inspected assertion. Behaviour and interaction invariants stay in `apps/web/`. Exact CSS pins move here. Mixed tests keep their behaviour assertions in `apps/web/`; their original complete case also runs here so no assertion is lost.

The primary contrast cases remain protected until guardrail 8 replaces them. Their original exact palette pins also run here. The new contrast contract must reject the original low-contrast muted ink and dark focus values.

A border alone must never identify a control. Decorative hairlines and labelled or filled control borders are exempt from the text and focus contrast thresholds.
