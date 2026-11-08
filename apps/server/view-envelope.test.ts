import { test } from "node:test";
import assert from "node:assert/strict";
import { FileUpload, FileRef } from "../../packages/protocol/files.ts";
import { ViewSpec, TableQuery } from "../../packages/protocol/views.ts";
import { Message } from "../../packages/protocol/index.ts";

test("additive file and view envelopes preserve old messages", () => {
  assert.equal(
    Message.parse({
      id: "old",
      role: "user",
      text: "Hello",
      createdAt: "2026-11-08",
    }).text,
    "Hello",
  );
  assert.equal(
    FileUpload.safeParse({ name: "sales.csv", data: "YQ==" }).success,
    true,
  );
  assert.equal(
    FileUpload.safeParse({ name: "sales.csv", data: "not base64" }).success,
    false,
  );
  assert.equal(
    FileRef.safeParse({ sha: "../../etc/passwd", name: "x" }).success,
    false,
  );
  const query = { id: "sales", file: "a".repeat(64) };
  assert.equal(TableQuery.safeParse({ ...query, limit: 501 }).success, false);
  const view = {
    version: 1,
    id: "view",
    revision: 1,
    intent: "Sales",
    title: "Sales",
    files: [],
    queries: [query],
    quotes: [],
    root: { key: "main", type: "FuturePart", props: {}, alt: "Sales view" },
    followUps: [],
  };
  assert.equal(ViewSpec.safeParse(view).success, true);
  assert.equal(
    ViewSpec.safeParse({
      ...view,
      root: { ...view.root, props: { handler: () => 1 } },
    }).success,
    false,
  );
  assert.equal(
    ViewSpec.safeParse({ ...view, title: "<script>" }).success,
    false,
  );
  assert.equal(
    ViewSpec.safeParse({ ...view, code: "alert(1)" }).success,
    false,
  );
});
