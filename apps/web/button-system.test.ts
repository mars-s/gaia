import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfilePanel } from "./profile-panel";
import { SharedComposer } from "./shared-composer";
import { ManagedSettings } from "./managed-settings";
import { SocialButton } from "./components/base/social-button/social-button";
import { ReplyNotice } from "./progress-row";
import { SetupSettings } from "./experiences";
import { ExperienceProposalNotice } from "./experiences/proposal";
import { createExperienceController } from "./experiences/controller";
import { experienceFixture } from "../server/testing/experiences";
import { SettingsIndex } from "./settings-index";
import { AppearancePicker } from "./appearance";
import { ChatSwitcher } from "./chat-switcher";
import { homeSnapshot } from "./conversation-fixtures";

function buttons(html: string) {
  const tags = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(m => m[0]);
  for (const tag of tags) {
    const classes = tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [];
    assert.equal(classes.filter(c => ["primary-action", "secondary-action", "quiet-action", "inline-link"].includes(c)).length, 1, tag);
  }
  return tags;
}

test("main screens render every button with exactly one of the three action classes or an inline sentence link", async t => {
  const fixture = await experienceFixture(t);
  const proposal = await fixture.propose("bots");
  const controller = createExperienceController();
  t.after(() => controller.pause());
  controller.profiles = [{ ...proposal, kind: "ready" }];
  const screens = [
    createElement(AppearancePicker),
    createElement(SettingsIndex, {current: "plan-title", onSelect() {}}),
    createElement(ChatSwitcher, { profiles: [], currentId: null, mainId: null, onSelect() {} }),
    createElement(SocialButton, { brand: "custom", config: { label: "ChatGPT", icon: "" } }),
    ...[false, true].map(account => createElement(ProfilePanel, {
      state: { kind: "new" }, failed: false, account, disabled: false, onAction() {}, onRetry() {},
    })),
    createElement(ManagedSettings, { runtime: undefined }),
    createElement(SetupSettings, { controller, onOpen() {}, onBack() {}, onReviewConversation() {} }),
    createElement(ExperienceProposalNotice, { proposals: [proposal], disabled: false }),
    createElement(ReplyNotice, { message: "Couldn’t finish that reply.", onRetry() {}, onSettings() {} }),
    ...[false, true].map(stopping => createElement(SharedComposer, {
      label: "Message Gaia", placeholder: "Message Gaia…", draft: "Hello", images: [], ready: true,
      supportsImages: true, actionsDisabled: false, modelDisabled: stopping, canSend: true,
      chat: homeSnapshot().chat, onChange() {}, onRemove() {}, onImages() {}, onCompose() {},
      onCompact() {}, onSelect() {}, onSend() {}, ...(stopping ? { onStop() {} } : {}),
    })),
  ];
  let count = 0;
  for (const screen of screens) count += buttons(renderToStaticMarkup(screen)).length;
  assert.equal(count, 28);
});
