import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createAuth } from "./auth.ts";
import { createPi, type ChatAdapter } from "./pi.ts";
import { createChatServer, openDatabase } from "./server.ts";
import { openOwnerProfile } from "./profile.ts";
import {
  OwnerProfile,
  type OwnerCapability,
  nextOwnerQuestion,
} from "../../packages/sdk/onboarding.ts";
const value: OwnerProfile = {
  name: "Avi",
  purpose: "Study",
  lifeAreas: ["University"],
  workingStyle: "balanced",
};
function proposal(store: ReturnType<typeof openOwnerProfile>) {
  const state = store.read();
  assert.equal(state.kind, "proposed");
  if (state.kind !== "proposed") throw new Error("Expected a proposal.");
  return state;
}
const fingerprint = (db: DatabaseSync) =>
  db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name",
    )
    .all();

test("profile lifecycle is atomic, private, bounded, reopens and leaves schema unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-profile-"));
  const db = await openDatabase(dir);
  const path = join(dir, "owner-profile.json");
  try {
    const schema = fingerprint(db);
    const p = openOwnerProfile(db);
    assert.deepEqual(p.read(), { kind: "new" });
    assert.equal(p.action("confirm"), false);
    assert.throws(() => p.propose(value));
    assert(p.action("start"));
    assert.throws(() => p.propose({ ...value, name: "a".repeat(101) }));
    assert.equal(
      OwnerProfile.safeParse({ ...value, workingStyle: "unknown" }).success,
      false,
    );
    p.propose(value);
    assert.equal(openOwnerProfile(db).read().kind, "proposed");
    assert(p.action("edit"));
    assert.equal(p.action("confirm"), false);
    p.propose(value);
    assert(p.action("confirm", proposal(p).proposalId));
    assert.deepEqual(openOwnerProfile(db).read(), {
      kind: "ready",
      profile: value,
    });
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(p.action("skip"), false);
    assert.deepEqual(fingerprint(db), schema);
    await writeFile(path, "broken");
    assert.throws(() => p.action("start"));
    assert.throws(() => p.action("reset"));
    assert.equal(await readFile(path, "utf8"), "broken");
    await writeFile(path, "x".repeat(16385));
    assert.throws(() => p.read());
    await rm(path);
    assert(p.action("skip"));
    assert.equal(openOwnerProfile(db).read().kind, "skipped");
    assert(p.action("reset"));
    assert.equal(p.read().kind, "new");
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a proposal preserves exact retained answers and single-purpose setup has no mandatory area question", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-profile-boundaries-"));
  const db = await openDatabase(dir);
  try {
    const profile = openOwnerProfile(db);
    profile.action("start");
    const approvalPreferences =
      "Ask before contacting other people or acting on my behalf.";
    profile.record({
      name: "Synthetic owner",
      purpose: "Research",
      workingStyle: "balanced",
      approvalPreferences,
    });
    const state = profile.read();
    assert.equal(state.kind, "interview");
    if (state.kind !== "interview") throw new Error("Expected interview");
    assert.equal(nextOwnerQuestion(state.answers), undefined);
    profile.propose({
      ...value,
      approvalPreferences: "Take every action without asking.",
    });
    assert.deepEqual(proposal(profile).profile, {
      name: "Synthetic owner",
      purpose: "Research",
      workingStyle: "balanced",
      lifeAreas: value.lifeAreas,
      approvalPreferences,
    });
    assert.deepEqual(
      OwnerProfile.parse({
        name: "Synthetic owner",
        purpose: "Research",
        workingStyle: "chat",
      }).lifeAreas,
      [],
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP profile guards, explicit confirmation, retained history and expired capabilities", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-profile-http-"));
  const db = await openDatabase(dir);
  let connected = true;
  let allowed = true;
  let capability: OwnerCapability | undefined;
  const adapter: ChatAdapter = {
    async run({ owner, signal, onText, text }) {
      capability = owner;
      onText("Setup answer");
      if (text === "Profile is corrupt") {
        assert.equal(owner?.read(), undefined);
        return;
      }
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      assert.throws(() => owner?.propose(value));
    },
    async close() {},
  };
  const origins: string[] = [];
  const app = createChatServer({
    db,
    adapter,
    origins,
    allowWrite: async () => allowed,
    auth: {
      status: () =>
        connected
          ? { kind: "connected", model: "gpt-6.1-sol" }
          : { kind: "disconnected", message: "Connect first" },
      connect() {},
      reply() {},
      async close() {},
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  origins.push(base);
  const req = (path: string, input?: unknown, headers = {}) =>
    fetch(base + "/api/v1/" + path, {
      method: input === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
  try {
    assert.equal((await req("profile/confirm", {})).status, 400);
    assert.equal((await req("profile/start", { profile: value })).status, 400);
    assert.equal(
      (await req("profile/start", {}, { origin: "https://evil.example" }))
        .status,
      403,
    );
    assert.equal(
      (await req("profile/start", {}, { "sec-fetch-site": "cross-site" }))
        .status,
      403,
    );
    connected = false;
    assert.equal((await req("profile")).status, 409);
    assert.equal((await req("profile/start", {})).status, 409);
    connected = true;
    allowed = false;
    assert.equal((await req("profile/start", {})).status, 503);
    allowed = true;
    assert.equal((await req("profile/start", {})).status, 202);
    assert.equal((await req("profile/unknown", {})).status, 409);
    await req("messages", { text: "My setup", requestId: randomUUID() });
    assert.equal((await req("profile/skip", {})).status, 202);
    await req("stop", {});
    for (
      let i = 0;
      i < 100 && app.snapshot().thread.run.kind === "running";
      i++
    )
      await new Promise((r) => setTimeout(r, 5));
    assert(capability);
    assert.throws(() => capability?.propose(value));
    const store = openOwnerProfile(db);
    assert.equal(store.read().kind, "skipped");
    assert(store.action("start"));
    store.propose(value);
    const oldProposal = proposal(store);
    assert(store.action("edit"));
    store.propose({ ...value, purpose: "A revised purpose" });
    assert.equal(
      (await req("profile/confirm", { proposalId: oldProposal.proposalId }))
        .status,
      409,
    );
    assert.equal(store.read().kind, "proposed");
    assert.equal(
      (
        await req("profile/confirm", {
          profile: { ...value, name: "Injected" },
        })
      ).status,
      400,
    );
    assert.equal(
      (await req("profile/confirm", { proposalId: proposal(store).proposalId }))
        .status,
      202,
    );
    const history = app.snapshot().thread.messages;
    assert.equal((await req("profile/reset", {})).status, 202);
    assert.deepEqual(app.snapshot().thread.messages, history);
    assert.deepEqual(await (await req("profile")).json(), { kind: "new" });
    await writeFile(join(dir, "owner-profile.json"), "broken");
    assert.equal((await req("profile")).status, 500);
    await req("messages", {
      text: "Profile is corrupt",
      requestId: randomUUID(),
    });
    for (
      let i = 0;
      i < 100 && app.snapshot().thread.run.kind === "running";
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(app.snapshot().thread.run.kind, "idle");
    assert.equal(app.snapshot().thread.messages.at(-1)?.text, "Setup answer");
    assert.equal(
      await readFile(join(dir, "owner-profile.json"), "utf8"),
      "broken",
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("real Pi tool round proposes only, and confirmed context survives reopen without schema changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-profile-pi-"));
  const db = await openDatabase(dir);
  const auth = createAuth(db);
  const faux = fauxProvider({
    provider: "openai-codex",
    models: [{ id: "gpt-6.1-sol" }],
    tokensPerSecond: 100000,
  });
  auth.models.setProvider(faux.provider);
    auth.planAvailability.connectedProviders = () => new Set(["openai-codex"]);
  const p = openOwnerProfile(db);
  p.action("start");
  const path = join(dir, "pi.sqlite");
  let pi = await createPi(path, auth);
  const observer = new DatabaseSync(path);
  try {
    const schema = fingerprint(observer);
    faux.setResponses([
      (context) => {
        assert.match(
          JSON.stringify(context.messages),
          /Owner has explicitly started optional setup/,
        );
        return fauxAssistantMessage(
          [
            {
              type: "toolCall",
              id: "proposal-1",
              name: "propose_owner_profile",
              arguments: value,
            },
          ],
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("Please review and Save."),
    ]);
    const run = () =>
      pi.run({
        text: "My name is Avi, for study at university, balanced help.",
        requestId: randomUUID(),
        signal: new AbortController().signal,
        onText() {},
        owner: p,
      });
    await run();
    assert.equal(p.read().kind, "proposed");
    assert(p.action("confirm", proposal(p).proposalId));
    await pi.close();
    pi = await createPi(path, auth);
    faux.setResponses([
      (context) => {
        assert.match(
          JSON.stringify(context.messages),
          /Confirmed owner context/,
        );
        assert.match(JSON.stringify(context.messages), /University/);
        return fauxAssistantMessage("Normal reply.");
      },
    ]);
    await run();
    assert.deepEqual(fingerprint(observer), schema);
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      pi.run({
        text: "Cancelled",
        requestId: randomUUID(),
        signal: cancelled.signal,
        onText() {},
        owner: p,
      }),
    );
    assert.equal(p.read().kind, "ready");
  } finally {
    observer.close();
    await pi.close();
    await auth.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("sequential Pi setup retains explicit answers across reopen and asks only the next missing question", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-profile-progress-"));
  const db = await openDatabase(dir);
  const auth = createAuth(db);
  const faux = fauxProvider({
    provider: "openai-codex",
    models: [{ id: "gpt-6.1-sol" }],
    tokensPerSecond: 100000,
  });
  auth.models.setProvider(faux.provider);
    auth.planAvailability.connectedProviders = () => new Set(["openai-codex"]);
  const profile = openOwnerProfile(db);
  profile.action("start");
  let pi = await createPi(join(dir, "pi.sqlite"), auth);
  const run = (text: string) =>
    pi.run({
      text,
      requestId: randomUUID(),
      owner: profile,
      signal: new AbortController().signal,
      onText() {},
    });
  try {
    faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "answers-1",
            name: "record_owner_answers",
            arguments: {
              name: "Avi",
              workingStyle: "agentic",
              approvalPreferences:
                "Ask before contacting other people or acting on my behalf.",
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        const prompt =
          context.messages
            .filter((m) => m.role === "system")
            .map((m) => m.sections?.["gaia-owner"] ?? "")
            .at(-1) ?? "";
        assert.match(
          prompt,
          /Next missing question: What would you most like Gaia to help you with/,
        );
        return fauxAssistantMessage(
          "What would you most like Gaia to help you with?",
        );
      },
    ]);
    await run(
      "Call me Avi, take initiative. Ask before contacting others or acting on my behalf.",
    );
    const first = profile.read();
    assert.equal(first.kind, "interview");
    if (first.kind !== "interview") throw new Error("Interview expected");
    assert.equal(first.answers?.name, "Avi");
    assert.match(nextOwnerQuestion(first.answers) ?? "", /most like/);
    await pi.close();
    pi = await createPi(join(dir, "pi.sqlite"), auth);
    faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: "toolCall",
            id: "answers-2",
            name: "record_owner_answers",
            arguments: {
              purpose: "Study and personal projects",
              lifeAreas: ["University", "Personal projects"],
            },
          },
        ],
        { stopReason: "toolUse" },
      ),
      (context) => {
        const prompt =
          context.messages
            .filter((m) => m.role === "system")
            .map((m) => m.sections?.["gaia-owner"] ?? "")
            .at(-1) ?? "";
        assert.match(prompt, /All questions answered/);
        return fauxAssistantMessage(
          [
            {
              type: "toolCall",
              id: "proposal-2",
              name: "propose_owner_profile",
              arguments: {
                ...value,
                purpose: "Study and personal projects",
                lifeAreas: ["University", "Personal projects"],
                workingStyle: "agentic",
                approvalPreferences:
                  "Ask before contacting other people or acting on my behalf.",
              },
            },
          ],
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("Review these details and Save when ready."),
    ]);
    await run(
      "Help with study and personal projects, across university and personal projects.",
    );
    const proposed = proposal(profile);
    assert.equal(proposed.profile.name, "Avi");
    assert.match(proposed.profile.approvalPreferences ?? "", /contacting/);
    assert(profile.action("edit"));
    const edited = profile.read();
    assert.equal(edited.kind, "interview");
    if (edited.kind === "interview")
      assert.equal(nextOwnerQuestion(edited.answers), undefined);
    assert(profile.action("skip"));
    assert.throws(() => profile.record({ name: "Inferred" }));
    faux.setResponses([
      (context) => {
        const messages = JSON.stringify(context.messages);
        assert.match(
          messages,
          /Answer the current request normally outside explicit setup/,
        );
        return fauxAssistantMessage("An ordinary chat reply.");
      },
    ]);
    await run("Just chat now.");
    assert.deepEqual(profile.read(), { kind: "skipped" });
  } finally {
    await pi.close();
    await auth.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
