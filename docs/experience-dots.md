# Dots central-chat acceptance

This case exercises the generic `single` layout through real Pi jobs and the public HTTP API. The product name appears only in the acceptance test and this document. No scheduler, controller, protocol, tool-host or provider implementation changes are needed.

Run the discoverable tests with:

```sh
npx tsx --test apps/server/experience-dots.test.ts
```

The standard `npm test` command also discovers both top-level tests. `apps/server/testing/dots.ts` supplies a temporary owned HTTP server, a real Pi tool extension and public scope-state polling. The existing `apps/server/testing/experiences.ts` supplies temporary SQLite stores and a faux subscription provider. Both servers bind to ephemeral loopback ports. No owner store or credential is used by the acceptance fixture.

## Observed behaviour

The first test creates an actual legacy conversation and answer before proposing a single-layout profile. A wrong confirmation revision returns 409 and creates no scopes. Exact confirmation creates one scope, configured by default with `gpt-6.1-sol` and `high` effort. The original legacy snapshot remains unchanged after the new profile finishes its jobs.

Two separate jobs make genuine POST requests to an owned webhook and form endpoint. The test checks both raw bodies, methods and content types. Each endpoint independently holds its response before committing its fixture effect. A third Pi job returns a completed quick answer while both HTTP calls remain held and neither effect has committed.

Model-generated descriptions reach Pi's real `api.details` call and appear in public scope state with the correct job and tool-call identities. The SSE stream carries the active jobs. Closing that stream leaves the HTTP calls running. The form finishes first while the webhook remains running, then the webhook finishes with a distinct receipt. The faux model's completion callback reads and parses each actual tool result. Assertions check both completed job text and the corresponding answer in the public conversation. No feed row or scheduler result is prefilled.

Replaying a request ID while its job is active or after settlement returns the same job. Reusing it with changed text returns 409. Exactly two HTTP requests and two independent effects remain, with no extra model invocation on settled replay. Terminal jobs have no active progress rows.

The second test stops one HTTP job while a separate form job and a third failing request run. Stop aborts the selected fetch, and the owned server observes its response connection close without committing that effect. The runtime truthfully marks the job `uncertain`, because cancelling an unsafe external call cannot supply a final tool receipt. Replaying that request returns the original job without resending. This is deliberately stronger than claiming a remote effect can always be undone.

The third endpoint returns an actual HTTP 503. Its completed model answer reports the status and endpoint body from the tool result. The independent form remains running until its own response is released, then returns its successful receipt. This proves an independent HTTP request failure, rather than a scheduler-level failed job. Only the surviving form commits an effect.

## Central layout review

Source inspection of `apps/web/experiences/view.tsx` found the existing single layout consistent with the quiet reference direction. It has no navigation sidebar, right-aligned rounded user bubbles, left-aligned assistant responses, a constrained conversation width and spacing between turns. Active work retains a small avatar and muted description. Stop has a task-specific accessible label. Completed jobs remove the active row. No clear source-level defect justified changing the shared view, composer or another layout, so the UI is unchanged.

Source inspection and HTTP tests are not native visual acceptance. The parent must still inspect the rendered conversation against the reference, including long replies, narrow widths, scrolling, bubbles and live progress. This work does not prove real subscription responses, hosted search, native tools, managed activation, Electron behaviour or deployment.

## Verification

The initial targeted run could not load Pi, and typecheck could not find TypeScript because the prepared checkout had no dependencies installed. With explicit parent authorisation, `npm ci` installed the exact committed lockfile. Neither package manifest nor lockfile changed.

The first executable test run passed the concurrent-result case and failed the Stop assertion, which had incorrectly expected `stopped` instead of `uncertain`. The expectation was corrected to the documented unsafe-invocation behaviour, without changing runtime code. Typecheck also caught assertion-induced array narrowing in the test; empty-effect checks now compare the length. Both targeted tests then passed.

The first full suite also reproduced a test comparison defect during managed source promotion. That fixture adds an extra response marker. The saved snapshot had passed through the public schema, which strips extra fields, but the final comparison used raw JSON. Both sides now use the same public snapshot schema. No protected source was read or changed to fix it. The complete check list was rerun after the fix.

Before committing, all required checks passed against this checkout: `npm run typecheck`, `npm run typecheck:desktop`, `npm run lint`, `npm test`, `npm run build`, `npm run check:protocol` and `git diff --check`. The full rerun recorded 225 tests, 224 passes, one existing opt-in skip and zero failures or cancellations. Both Dots tests passed in that run and in the targeted rerun. The build retained the existing Vite directive, source-map and bundle-size warnings. These checks remain separate from native visual acceptance. The implementation handback supplies the commit identity.
