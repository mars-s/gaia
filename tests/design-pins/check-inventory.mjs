import { URL } from "node:url";
import { log } from "node:console";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const rows = readFileSync(new URL("./inventory.tsv", import.meta.url), "utf8").trim().split("\n").slice(1).map(line => line.split("\t"));
const moved = rows.filter(row => row[3] === "move");
for (const [file, line, , , , assertion] of moved) {
  const source = readFileSync(new URL(basename(file), import.meta.url), "utf8").replaceAll('"../../apps/web/', '"./').replace(/\s+/g, " ");
  assert(source.includes(assertion), `${file}:${line} lost its moved assertion`);
}
log(`${moved.length} moved assertions retained in development checks; ${rows.filter(row => row[3] === "keep").length} assertions kept; ${rows.filter(row => row[3] === "fold").length} groups folded into guardrails 7 and 8.`);
