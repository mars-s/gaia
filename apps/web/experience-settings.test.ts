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
  assert.doesNotMatch(render(), /setup-open-now|>Current</);
  assert.doesNotMatch(render(), /Created|setup-status-badge|status-pill[^>]*>Current/);
  assert.match(rows()[1], /<button[^>]*class="[^"]*secondary-action[^"]*"[^]*Make main/);
  assert.match(rows()[0], /setup-row-actions[^]*You’re here[^]*<button[^]*Open/);
  assert.match(render(), /<li class="setup-list-row" aria-current="page"/);
  assert.doesNotMatch(rows()[1], /aria-current/);
  assert.equal((render().match(/class="[^"]*\bsetup-layout-icon\b[^"]*"/g) ?? []).length, 4);
  assert.match(rows()[1], /Open/);
  assert.match(rows()[1], /Make main/);
  assert.match(rows()[2], /Open/);
  assert.doesNotMatch(rows()[2], /Make main/);
  controller.mainId = bots.id;
  assert.equal((render().match(/class="status-pill" data-tone="accent">Main chat</g) ?? []).length, 1);
  assert.doesNotMatch(render(), /setup-open-now|>Current</);
  assert.match(text(rows()[1]), /Everyday BotsMain chat 2 Bots with separate memory/);
  assert.doesNotMatch(rows()[1], /Make main/);
  assert.match(rows()[0], /secondary-action[^]*Make main/);
  assert.doesNotMatch(
    render(),
    /Everyday BotsBots|Shared workspaceChannels|My sessionsSessions/,
  );
});

test("only Original chat keeps the manual creation action directly after its list", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.match(css, /setup-settings > ul \{ flex: none/);
 assert.match(css, /setup-create[^}]*margin-top: 12px/);
});

test("setup rows use unfilled rows, visible actions and wrapping descriptions", () => {
 const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");
 assert.doesNotMatch(css, /setup-list-row\[aria-current="page"\][^}]*background/);
 assert.match(css, /setup-name \+ p \{ white-space: normal; overflow-wrap: anywhere/);
 assert.match(css, /setup-row-actions \{ justify-content: flex-start/);
 const source = readFileSync(new URL("./experiences/index.tsx", import.meta.url), "utf8");
 assert.doesNotMatch(source, /Menu|More actions/);
 assert.equal((source.match(/You’re here/g) ?? []).length, 2);
});
