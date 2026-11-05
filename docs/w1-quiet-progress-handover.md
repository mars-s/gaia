# W1 quiet progress handover

Implements the accepted SPEC v1.5 progress behaviour from the parent checkout and the reconciled founder report. The local locked spec remains unchanged for the parent to commit and integrate.

## Changes

- `apps/web/experiences/view.tsx`: queued and running jobs show an avatar without title or fixed status words. Actual activity descriptions stay on one truncated line, with complete DOM text and a native title tooltip. Completed progress disappears while the streamed message and citations remain. Stop retains the exact task title in its accessible name. Recovery details and uncertain-repeat confirmation remain.
- Activity announcements use one explicit polite region outside the conversation log. The log's implicit live announcements are disabled to avoid duplicate activity speech. A conversation-local description map selects changed real wording, debounces it for 1,000 ms and suppresses repeated wording. Settlement cancels pending speech. The existing keyed conversation unmount disposes timers on scope changes.
- `apps/web/style.css` and `apps/web/public/gaia-mark.svg`: one 28px accent mark for single, channels and sessions. The luminance mask cuts out the upper-right dot so the conversation background shows through in either theme. Bots retain the existing DiceBear CC0 assets. Only an avatar waiting for activity pulses; reduced motion disables the pulse.
- The experience send button uses the legacy composer's pink disabled background, white icon, transparent border and 40% opacity. There is no shared composer adapter or structural composer change.
- `apps/web/experience-view.test.ts`: rendering checks cover all layouts, hidden progress titles, task-specific Stop names, concurrent real descriptions, one activity live region, completion with retained answer, and recovery controls. Timer tests cover debounce, unchanged wording, latest activity, settlement and disposal between conversation instances.

## Asset provenance

The Gaia mark is original in-house artwork authored for Gaia in this change. Copyright 2026 Gaia contributors, Apache-2.0, matching the repository licence. The SVG includes its SPDX notice. No external artwork was copied. Existing Bot provenance is unchanged.

## Verification

Final verification commands are `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npx tsx --test apps/web/experience-view.test.ts`, `npm run test:experiences`, `npm run build`, `npm run check:protocol` and `git diff --check`. All passed. The focused file passed 10 tests and the experience suite passed 81 tests. Build and protocol conformance ran once after the final application code. Vite reported ignored dependency `use client` directives and its large-chunk warning; the build succeeded. The mechanical Impeccable detector returned no findings.

The checkout initially had no dependencies. `npm ci --ignore-scripts` installed the existing lockfile without changing package manifests or the lockfile. Initial pre-install checks failed with missing TypeScript and React; these were setup failures, not passing verification.

## Evidence and remaining limits

Inspected the permitted synthetic source evidence `native-founder-before.png` and `native-central-320-models-focused.png` under the parent's `data/verification/four-profiles/`. No new browser or native screenshots were captured. Rendering checks use React server rendering. Timer checks exercise the actual announcement lifecycle object; they do not mount React effects or prove screen-reader speech, native tooltips, theme contrast or reduced-motion rendering. The parent still needs the owned-wait native check before activity, during real activity and after completion, plus narrow/wide light/dark evidence and the complete integrated suite serially.

No owner data, credentials, OAuth, real provider requests or native apps were accessed or operated. The protected core, dependency declarations and lockfile, protocol, server runtime, host tools and other workers' files remain unchanged. No push, PR or deployment occurred. Cancellation certainty and receipt/streaming changes remain the other workers' responsibility.

The data shape follows the existing discriminated job state. Model the Domain kept announcement state local to one conversation; Type System Discipline kept job and activity types derived from the protocol. The throughput checkpoint was the accepted spec before edits, no independent writers in this checkout, per-conversation mutable state, and one worker for this coupled UI change. Architecture exploration and child delegation were skipped under the explicit implementation-only brief.
