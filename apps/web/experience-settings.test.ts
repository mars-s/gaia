import { readFileSync } from "node:fs";
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
  assert.match(text(rows()[0]), /Original chatMain chat One conversation/);
  assert.equal((render().match(/class="status-pill" data-tone="accent">Main chat</g) ?? []).length, 1);
  assert.match(render(), /aria-label="Main chat: /);
  assert.equal((render().match(/>Open</g) ?? []).length, 4);
  assert.doesNotMatch(render(), /setup-open-now|>Current<|Make main chat|You’re here/);
  assert.doesNotMatch(render(), /Created|setup-status-badge|status-pill[^>]*>Current/);
  assert.match(render(), /<li class="setup-list-row" aria-current="page"/);
  assert.doesNotMatch(rows()[1], /aria-current/);
  assert.equal((render().match(/class="[^"]*\bsetup-layout-icon\b[^"]*"/g) ?? []).length, 4);
  assert.match(rows()[1], /Open/);
  assert.match(rows()[2], /Open/);
  assert.doesNotMatch(rows()[2], /Make main/);
  controller.mainId = bots.id;
  assert.equal((render().match(/class="status-pill" data-tone="accent">Main chat</g) ?? []).length, 1);
  assert.match(render(), /aria-label="Main chat: /);
  assert.equal((render().match(/>Open</g) ?? []).length, 4);
  assert.doesNotMatch(render(), /setup-open-now|>Current<|Make main chat|You’re here/);
  assert.match(text(rows()[1]), /Everyday BotsMain chat 2 Bots with separate memory/);
  assert.doesNotMatch(rows()[1], /Make main/);
  assert.doesNotMatch(
    render(),
    /Everyday BotsBots|Shared workspaceChannels|My sessionsSessions/,
  );
});

test("setup rows use unfilled rows, visible actions and wrapping descriptions", () => {
 const source = readFileSync(new URL("./experiences/index.tsx", import.meta.url), "utf8");
 assert.doesNotMatch(source, /More actions|Make main chat|You’re here/);
 assert.match(source, /controller.makeMain\(item.id\)/);
 assert.match(source, /<Menu.RadioItem closeOnClick/);
 assert.match(source, /Menu.Popup finalFocus=\{false\}/);
 assert.match(source, /useLayoutEffect\(\(\) => \{[^]*if \(!makingMain && restoreMainFocus.current\)/);
 assert.match(source, /mainTrigger.current\?\.focus\(\)/);
 assert.equal((source.match(/Main chat: /g) ?? []).length, 1);
});
