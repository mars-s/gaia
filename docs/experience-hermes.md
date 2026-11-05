# Sessions acceptance

`apps/server/experience-hermes.test.ts` runs real Pi against temporary SQLite stores and ephemeral loopback HTTP servers. Model output is synthetic. Admission, histories, scoped configuration, compaction and recovery use the actual runtime. Assertions read the public HTTP API rather than scheduler internals.

The tests cover the initial GPT-6.1 Sol High setting, completed replies, New session retaining previous history, separate model and effort settings, and restart without further provider calls. The compaction case invokes Pi's summariser, retains original visible messages, leaves the other session's content and settings unchanged, then verifies that a request after restart receives the persisted summary.

These tests are discoverable through `npm test`. Real subscription responses and native or managed acceptance belong to the parent. No managed feature is enabled by these changes.

## Client selection and parent integration

The controller stores `{ version: 1, selected: { profileId, scopeId } }` in `gaia:experience-selection:v1`. Explicit Original chat navigation stores `selected: null`. The preference contains no transcript, draft or image bytes. Drafts continue to use the existing separate profile and scope keys.

`restoreSelection()` returns a boolean. It leaves Original chat selected on first run, denied storage, malformed or unsupported preferences, unavailable profiles, missing scopes, mismatched profile and scope pairs, and unconfirmed proposals. It fetches the saved profile through the SDK and requires the exact saved scope in its confirmed scope list. It never silently chooses the first scope when the saved scope is missing. Failed server lookups clear the preference. Stored preferences do not confirm a proposal.

`original()` cancels outstanding controller requests, invalidates selection generations, closes the subscription and clears the selected profile and scope. The Profiles screen calls it for Original chat and Set up in chat. A delayed restoration cannot replace later Original chat or profile navigation. Scoped model, compaction and job response delivery also checks its request's abort signal, including after pause and resume.

The initial view restoration hook is integrated in `apps/web/app.tsx`, after the effects that pause or resume the experience controller. React Strict Mode can restart it safely because newer selection requests invalidate older ones. The effect below records the client integration.

```tsx
useEffect(() => {
  if (!connected || controller.safeMode || experienceView !== "original") return;
  let active = true;
  void experiences.restoreSelection().then((restored) => {
    if (active && restored) setExperienceView("chat");
  });
  return () => {
    active = false;
  };
}, [connected, state?.runtime?.mode, experienceView, controller, experiences]);
```

Any additional top-level Original chat navigation must call `experiences.original()` before setting the view to `original`. Keep the existing profile confirmation flow. No change is needed in `view.tsx`, the protocol, runtime, SDK or dependencies.

`apps/web/experience-session-selection.test.ts` drives the existing headless controller with real public HTTP profile reads and model changes. Subscription callbacks are controlled by the test so retired callbacks can be delivered deliberately. Tests cover exact-pair restoration, separate drafts, scoped model and effort controls, Original chat preference, malformed and unavailable selections, denied storage, and late navigation responses. The pause and resume regression failed before the request-abort fence, reporting `second` instead of `gpt-6.1-sol`, then passed after the fix.

Controller tests do not prove native reload acceptance. The root acceptance run verifies that surface separately. The fixture covers absent profile and scope UUIDs because the public API has no deletion route. No owner store, credentials, protected core, auth, native app or managed launcher is edited.

## Verification

Provisioning used `npm ci` with the existing committed lockfile. Neither dependency manifest changed. The 19 targeted server and controller tests passed after fixing the aborted-response fence. A further regression showed that serialising an entire scope object could retain an extra transcript property. The preference writer now copies only the two UUID fields, and the regression passes.

Before each concern commit, run `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npm test`, `npm run build`, `npm run check:protocol` and `git diff --check`. The first complete batch passed with 228 tests passing, one existing opt-in skip and zero failures. Build output retains the existing Vite directive, source-map and bundle-size warnings.

The second full batch passed both typechecks, lint, build, protocol and whitespace checks. Its test run failed in the existing protected-core scenario `three actual child crashes trigger pinned safe chat` with `ECONNREFUSED` on its loopback server. The containing suite also reports failure, giving 226 passes, two reported failures and one skip. All new tests passed in that run. No protected-core source was read or changed to investigate this failure. A full test rerun follows because the first complete run passed the same scenario.

The full rerun passed all 228 enabled tests with one opt-in skip and zero failures. This includes the previously failing child-crash scenario. All seven required checks therefore have a passing final result before the client selection commit. The intermittent core failure remains recorded for parent review.
