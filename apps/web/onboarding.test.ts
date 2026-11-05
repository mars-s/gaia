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
