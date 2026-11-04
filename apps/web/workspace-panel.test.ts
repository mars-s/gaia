import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WorkspaceNavigation,
  WorkspaceProposalPanel,
} from "./workspace-panel.tsx";
import { homeScope } from "./workspace-controller.ts";
import { multiWorkspace, proposalId } from "./conversation-fixtures.ts";
import type { WorkspaceState } from "../../packages/sdk/workspace.ts";

test("single, unconfirmed and empty workspaces have no area navigation; confirmed multi uses exact backend labels", () => {
  const single: WorkspaceState = {
    kind: "confirmed",
    proposal: {
      proposalId,
      revision: 1,
      workspace: { kind: "single", purpose: "Research" },
      sharedPreferences: [],
    },
  };
  for (const state of [
    undefined,
    { kind: "empty" } satisfies WorkspaceState,
    single,
    { ...multiWorkspace(), kind: "proposed" } satisfies WorkspaceState,
  ]) {
    assert.equal(
      renderToStaticMarkup(
        createElement(WorkspaceNavigation, {
          state,
          selected: homeScope,
          onSelect() {},
        }),
      ),
      "",
    );
  }
  const html = renderToStaticMarkup(
    createElement(WorkspaceNavigation, {
      state: multiWorkspace(),
      selected: homeScope,
      onSelect() {},
    }),
  );
  assert(html.includes(">Home</button>"));
  assert(html.includes(">Study</button>"));
  assert(html.includes(">Garden</button>"));
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
});

test("the pending proposal displays exact purposes and preferences and disappears on confirmation", () => {
  const multi = multiWorkspace();
  assert(multi.kind === "confirmed");
  const props = {
    state: { ...multi, kind: "proposed" } satisfies WorkspaceState,
    error: "",
    disabled: false,
    onConfirm() {},
    onRetry() {},
  };
  const html = renderToStaticMarkup(
    createElement(WorkspaceProposalPanel, props),
  );
  for (const value of [
    "Review coursework",
    "Plan seasonal planting",
    "Use Australian English",
    "Confirm setup",
  ])
    assert(html.includes(value));
  assert.equal(
    renderToStaticMarkup(
      createElement(WorkspaceProposalPanel, { ...props, state: multi }),
    ),
    "",
  );
});
