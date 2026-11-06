import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { experienceFixture } from "../server/testing/experiences.ts";
import { createExperienceController } from "./experiences/controller";
import { SetupSettings } from "./experiences";

test("Settings rows separate names and layout text, identify exactly one main chat and offer the right actions", async (t) => {
  const f = await experienceFixture(t);
  const bots = await f.propose("bots");
  const channels = await f.propose("channels");
  const sessions = await f.propose("sessions");
  const controller = createExperienceController();
  t.after(() => controller.pause());
  controller.profiles = [
    { ...bots, kind: "ready", plan: { ...bots.plan, title: "Everyday Bots" } },
    { ...channels, plan: { ...channels.plan, title: "Shared workspace" } },
    {
      ...sessions,
      plan: { ...sessions.plan, title: "My sessions" },
      proposal: {
        ...sessions.proposal!,
        dismissedAt: new Date().toISOString(),
      },
    },
  ];
  const render = () =>
    renderToStaticMarkup(
      createElement(SetupSettings, {
        controller,
        onOpen() {},
        onBack() {},
        onReviewConversation() {},
      }),
    );
  const rows = () =>
    [...render().matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  const text = (row: string) => row.replace(/<[^>]*>/g, "");
  assert.match(text(rows()[1]), /Everyday Bots 2 Bots with separate memory/);
  assert.match(
    text(rows()[2]),
    /Shared workspace 2 channels with shared memoryProposed/,
  );
  assert.match(text(rows()[3]), /My sessions 2 sessions with separate historiesHidden/);
  assert.match(text(rows()[0]), /Original chat One conversationMainCurrent/);
  assert.equal((render().match(/class="status-pill" data-tone="accent">Main</g) ?? []).length, 1);
  assert.equal((render().match(/class="setup-current">Current</g) ?? []).length, 1);
  assert.doesNotMatch(render(), /Created|setup-status-badge/);
  assert.match(rows()[1], /<button class="quiet-action"[^]*Make main/);
  assert.doesNotMatch(rows()[0], /<button/);
  assert.equal((render().match(/class="[^"]*\bsetup-layout-icon\b[^"]*"/g) ?? []).length, 4);
  assert.match(rows()[1], /Open/);
  assert.match(rows()[1], /Make main/);
  assert.match(rows()[2], /Review/);
  assert.doesNotMatch(rows()[2], /Make main/);
  controller.mainId = bots.id;
  assert.equal((render().match(/class="status-pill" data-tone="accent">Main</g) ?? []).length, 1);
  assert.equal((render().match(/class="setup-current">Current</g) ?? []).length, 1);
  assert.match(text(rows()[1]), /2 Bots with separate memoryMain/);
  assert.doesNotMatch(rows()[1], /Make main/);
  assert.doesNotMatch(rows()[0], /<button/);
  assert.doesNotMatch(
    render(),
    /Everyday BotsBots|Shared workspaceChannels|My sessionsSessions/,
  );
});
