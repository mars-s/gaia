import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fauxProvider } from "@earendil-works/pi-ai";
import { Snapshot } from "../../../packages/protocol/index.ts";
import { AreaSnapshot } from "../../../packages/sdk/areas.ts";
import {
  AreaId,
  WorkspaceProposal,
  type WorkspaceRequest,
} from "../../../packages/sdk/workspace.ts";
import { createAuth } from "../auth.ts";
import { createPi } from "../pi.ts";
import { createChatServer, openDatabase } from "../server.ts";

export const plan: WorkspaceRequest = {
  plan: {
    kind: "multi",
    areas: [
      { label: "Research", purpose: "Synthetic research purpose marker" },
      { label: "Garden", purpose: "Synthetic garden purpose marker" },
    ],
  },
  sharedPreferences: ["Explicit shared preference marker"],
};
export const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
export function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
export async function workspaceFixture(
  t: TestContext,
  areasEnabled = true,
  directory?: string,
  realEffort = false,
) {
  const dir = directory ?? (await mkdtemp(join(tmpdir(), "gaia-area-api-")));
  const faux = fauxProvider({
    provider: "openai-codex",
    models: [
      { id: "gpt-6.1-sol", reasoning: true, input: ["text", "image"] },
      { id: "area-second", reasoning: true, input: ["text", "image"] },
      { id: "text-only", input: ["text"] },
    ],
    tokensPerSecond: 100000,
  });
  let connected = true;
  let allowed = true;
  async function open() {
    const db = await openDatabase(dir);
    const auth = createAuth(db);
    if (realEffort)
      faux.models[0].thinkingLevelMap = auth.models.getModel(
        "openai-codex",
        "gpt-6.1-sol",
      )?.thinkingLevelMap;
    auth.models.setProvider(faux.provider);
    auth.planAvailability.connectedProviders = () => new Set(["openai-codex"]);
    const pi = await createPi(
      join(dir, "pi.sqlite"),
      auth,
      [],
      { compaction: { enabled: false, keepRecentTokens: 1 } },
      { areasEnabled },
    );
    const origins: string[] = [];
    const app = createChatServer({
      db,
      adapter: pi,
      origins,
      allowWrite: async () => allowed,
      auth: {
        status: () =>
          connected
            ? { kind: "connected", model: "gpt-6.1-sol" }
            : { kind: "disconnected", message: "Connect first" },
        connect() {},
        reply() {},
        close: () => auth.close(),
      },
    });
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const address = app.server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    origins.push(base);
    return { db, auth, pi, app, base };
  }
  let live = await open();
  let closed = false;
  t.after(async () => {
    if (!closed) await live.app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const request = (
    path: string,
    input?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(live.base + "/api/v1/" + path, {
      method: input === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...headers },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
  const home = async () =>
    Snapshot.parse(await (await request("state")).json());
  const area = async (id: AreaId) =>
    AreaSnapshot.parse(await (await request(`areas/${id}/state`)).json());
  return {
    dir,
    faux,
    request,
    home,
    area,
    get db() {
      return live.db;
    },
    get auth() {
      return live.auth;
    },
    get pi() {
      return live.pi;
    },
    get app() {
      return live.app;
    },
    set connected(value: boolean) {
      connected = value;
    },
    set allowed(value: boolean) {
      allowed = value;
    },
    async confirm(input = plan) {
      const proposed = await request("workspace/propose", input);
      assert.equal(proposed.status, 201, await proposed.clone().text());
      const proposal = WorkspaceProposal.parse(await proposed.json());
      const result = await request("workspace/confirm", {
        proposalId: proposal.proposalId,
        revision: proposal.revision,
      });
      assert.equal(result.status, 200, await result.clone().text());
      if (proposal.workspace.kind !== "multi")
        throw new Error("Expected multi workspace.");
      const [first, second] = proposal.workspace.areas;
      return {
        proposal,
        first: AreaId.parse(first.areaId),
        second: AreaId.parse(second.areaId),
      };
    },
    async settled(id?: AreaId) {
      for (let count = 0; count < 500; count++) {
        const snapshot = id ? await area(id) : await home();
        if (snapshot.thread.run.kind !== "running") return snapshot;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Chat did not settle.");
    },
    schema() {
      const db = new DatabaseSync(join(dir, "pi.sqlite"), { readOnly: true });
      try {
        return db
          .prepare("SELECT name, sql FROM sqlite_master ORDER BY name")
          .all();
      } finally {
        db.close();
      }
    },
    async reopen() {
      await live.app.close();
      live = await open();
    },
    async close() {
      await live.app.close();
      closed = true;
    },
  };
}
