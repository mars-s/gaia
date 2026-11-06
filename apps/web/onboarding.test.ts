import { EmptyChat } from "./empty-chat";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OwnerState,
  nextOwnerQuestion,
  interviewQuestionVisible,
} from "../../packages/sdk/onboarding.ts";
import { ProfilePanel } from "./profile-panel.tsx";

test("legacy owner states load and answered setup prompts disappear without re-asking collected fields", () => {
  for (const kind of ["new", "interview", "skipped"])
    assert.equal(OwnerState.parse({ kind }).kind, kind);
  const profile = {
    name: "Avi",
    purpose: "Study",
    lifeAreas: [],
    workingStyle: "agentic",
  };
  assert.equal(OwnerState.parse({ kind: "ready", profile }).kind, "ready");
  const interview = {
    kind: "interview",
    startedAt: "2026-11-05T00:00:00.000Z",
  } satisfies OwnerState;
  assert(interviewQuestionVisible(interview, []));
  assert(
    !interviewQuestionVisible(interview, [
      { role: "user", createdAt: "2026-11-05T00:00:01.000Z" },
    ]),
  );
  assert(
    !interviewQuestionVisible({ kind: "interview" }, [
      { role: "user", createdAt: "old" },
    ]),
  );
  assert.equal(
    nextOwnerQuestion({ name: "Avi", workingStyle: "agentic" }),
    "What would you most like Gaia to help you with?",
  );
  const html = renderToStaticMarkup(
    createElement(ProfilePanel, {
      state: {
        ...interview,
        answers: { name: "Avi", workingStyle: "agentic" },
      },
      failed: false,
      account: false,
      disabled: true,
      skipDisabled: false,
      onAction() {},
      onRetry() {},
    }),
  );
  assert(!html.includes("What should"));
  assert(!html.includes("most like"));
  assert(html.includes("Skip interview"));
  assert(
    !html.includes("disabled="),
    "Skip stays available during a model reply.",
  );
  const skipped = renderToStaticMarkup(
    createElement(ProfilePanel, {
      state: { kind: "skipped" },
      failed: false,
      account: false,
      disabled: false,
      onAction() {},
      onRetry() {},
    }),
  );
  assert(!skipped.includes("Start setup"));
});

test("new owners get the optional offer after an answer, with a permanent skip action", () => {
 const html = renderToStaticMarkup(createElement(ProfilePanel, {state: {kind: "new"}, failed: false, account: false, disabled: false, onAction() {}, onRetry() {}}));
 assert.match(html, /If you like, I can fit myself around how you work/);
 assert.match(html, />Start the short interview</);
 assert.match(html, />Not now</);
});

test("empty chat is only its mark and headline; an interview needs a useful answer", () => {
 const html = renderToStaticMarkup(createElement(EmptyChat));
 assert.match(html, /gaia-mark/);
 assert.match(html, /What’s on your mind/);
 assert.doesNotMatch(html, /interview|Skip|button/);
 const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
 assert.match(app, /profile\?.kind === "new" && id === active.thread.messages.at\(-1\)\?.id && active.thread.run.kind === "idle"/);
});

test("interview offer is a proposal-family card in Gaia’s voice", () => {
 const source = readFileSync(new URL("./profile-panel.tsx", import.meta.url), "utf8");
 assert.match(source, /className="setup-card interview-offer [^"]*rounded-xl border/);
 assert.match(source, /ProposalCardContent title="Fit Gaia around you" status="Suggestion"/);
 assert.match(source, /If you like, I can fit myself around how you work\./);
});
