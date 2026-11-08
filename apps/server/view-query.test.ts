import { test } from "node:test";
import assert from "node:assert/strict";
import { runQuery, verifyQuote } from "./views/query.ts";
import type { ParsedFile } from "../../packages/protocol/files.ts";
const sha = "a".repeat(64);
const file: ParsedFile = {
  kind: "csv",
  columns: [
    { name: "Region", type: "category" },
    { name: "Sales", type: "number" },
    { name: "Date", type: "date" },
  ],
  rows: [
    ["East", 10, "2026-08-01"],
    ["West", 30, "2026-08-02"],
    ["East", 20, "2026-08-03"],
  ],
};

test("queries filter, bin, aggregate, sort and limit over every row", () => {
  const q = {
    id: "q",
    file: sha,
    groupBy: ["Region"],
    aggregate: [{ field: "Sales", op: "sum", as: "Total" }],
    sort: [{ field: "Region", direction: "asc" }],
  };
  assert.deepEqual(runQuery(q, file), [
    { Region: "East", Total: 30 },
    { Region: "West", Total: 30 },
  ]);
  assert.deepEqual(
    runQuery(
      {
        id: "q",
        file: sha,
        groupBy: ["Date"],
        bin: { field: "Date", unit: "week" },
        aggregate: [{ op: "count", as: "Count" }],
      },
      file,
    ),
    [
      { Date: "2026-07-27", Count: 2 },
      { Date: "2026-08-03", Count: 1 },
    ],
  );
  assert.deepEqual(
    runQuery(
      {
        ...q,
        filter: [{ field: "Region", op: "eq", value: "East" }],
        aggregate: [{ field: "Sales", op: "mean", as: "Mean" }],
        limit: 1,
      },
      file,
    ),
    [{ Region: "East", Mean: 15 }],
  );
  assert.throws(
    () =>
      runQuery(
        { ...q, aggregate: [{ field: "Region", op: "sum", as: "Total" }] },
        file,
      ),
    /number/,
  );
  assert.throws(
    () => runQuery({ ...q, groupBy: ["missing"] }, file),
    /Unknown/,
  );
  assert.throws(() => runQuery({ ...q, expression: "process.exit()" }, file));
});

test("seeded generated table queries match an independent reference", () => {
  let seed = 42;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % 100;
  };
  for (let n = 0; n < 60; n++) {
    const rows = Array.from({ length: random() + 1 }, () => [
      random() % 2 ? "East" : "West",
      random(),
      "2026-08-01",
    ]);
    const data = { ...file, rows };
    const parsed = runQuery(
      {
        id: "q",
        file: sha,
        groupBy: ["Region"],
        aggregate: [{ field: "Sales", op: "sum", as: "Total" }],
      },
      data,
    );
    for (const region of ["East", "West"]) {
      const values = rows
        .filter((r) => r[0] === region)
        .map((r) => Number(r[1]));
      assert.equal(
        parsed.find((r) => r.Region === region)?.Total ?? 0,
        values.reduce((a, b) => a + b, 0),
      );
    }
  }
});

test("quotes must match exact source spans", () => {
  const document: ParsedFile = {
    kind: "docx",
    blocks: [],
    text: "East target is 120000.",
  };
  const quote = {
    id: "q",
    file: sha,
    text: document.text,
    span: { start: 0, end: document.text.length },
  };
  assert.equal(verifyQuote(quote, document).text, document.text);
  assert.throws(
    () => verifyQuote({ ...quote, text: "East target is 200000." }, document),
    /match/,
  );
});
