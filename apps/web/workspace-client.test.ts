import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readWorkspace,
  readArea,
} from "../../packages/sdk/workspace-client.ts";
import { firstArea } from "./conversation-fixtures.ts";

test("workspace network failures and unreadable proxy responses give recoverable messages", async (t) => {
  let failure: "timeout" | "network" | "html" | "schema" | "conflict" =
    "timeout";
  t.mock.method(globalThis, "fetch", async () => {
    if (failure === "timeout")
      throw new DOMException("signal timed out", "TimeoutError");
    if (failure === "network") throw new TypeError("Failed to fetch");
    if (failure === "html")
      return new Response("<html>Bad Gateway</html>", { status: 502 });
    if (failure === "conflict")
      return Response.json(
        { error: "Work is already running." },
        { status: 409 },
      );
    return Response.json({ kind: "unsupported" });
  });
  await assert.rejects(readWorkspace(), /taking too long.*draft is still here/);
  failure = "network";
  await assert.rejects(readArea(firstArea), /could not be reached/);
  failure = "html";
  await assert.rejects(
    readWorkspace(),
    /unreadable response.*draft is still here/,
  );
  failure = "schema";
  await assert.rejects(readWorkspace(), /unsupported conversation details/);
  failure = "conflict";
  await assert.rejects(readArea(firstArea), {
    message: "Work is already running.",
  });
});
