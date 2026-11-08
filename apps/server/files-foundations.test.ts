import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { openFiles } from "./files/store.ts";
import { parseInWorker } from "./files/worker.ts";
import { checkDocxZip } from "./files/parse.ts";
import { fileLimits } from "../../packages/protocol/files.ts";

async function review() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    "word/document.xml",
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Q3 review</w:t></w:r></w:p><w:p><w:r><w:t>East target is 120000.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>East</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
function pdf() {
  const stream = "BT /F1 12 Tf 72 720 Td (Q3 board pack) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

test("local store deduplicates bytes, sniffs wrong extensions and survives reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gaia-files-"));
  try {
    const store = openFiles(dir);
    const data = Buffer.from(
      "Region,Sales,Date,Note\nEast,100,2026-08-01,=1+1\nWest,-20,2026-08-02,@bad\n",
    ).toString("base64");
    const [a, b] = await Promise.all([
      store.put({ name: "sales.pdf", data }),
      store.put({ name: "sales.csv", data }),
    ]);
    assert.equal(a.kind, "csv");
    assert.equal(a.file.sha, b.file.sha);
    assert.equal(b.file.name, "sales.csv");
    assert.equal((await readdir(join(dir, "files"))).length, 1);
    const { parsed } = await openFiles(dir).read(a.file.sha);
    assert.equal(parsed.kind, "csv");
    if (parsed.kind !== "csv") assert.fail();
    assert.deepEqual(
      parsed.columns.map((c) => c.type),
      ["category", "number", "date", "category"],
    );
    assert.deepEqual(parsed.rows[0], ["East", 100, "2026-08-01", "=1+1"]);
    assert.equal(parsed.rows[1][1], -20);
    assert.equal(
      (await readFile(join(dir, "files", a.file.sha, "original"))).toString(
        "base64",
      ),
      data,
    );
    await assert.rejects(store.read("../escape"));
    await assert.rejects(store.put({ name: "bad.csv", data: "!!!!" }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DOCX becomes a plain document tree and PDF keeps page text", async () => {
  const doc = await parseInWorker(await review());
  assert.equal(doc.kind, "docx");
  if (doc.kind !== "docx") assert.fail();
  assert.deepEqual(doc.blocks[0], {
    kind: "heading",
    level: 1,
    text: "Q3 review",
  });
  assert.equal(
    doc.blocks.some((b) => b.kind === "table"),
    true,
  );
  assert.match(doc.text, /East target is 120000/);
  assert.equal(JSON.stringify(doc).includes("<w:"), false);
  const parsed = await parseInWorker(pdf());
  assert.equal(parsed.kind, "pdf");
  if (parsed.kind !== "pdf") assert.fail();
  assert.equal(parsed.pages.length, 1);
  assert.match(parsed.text, /Q3 board pack/);
});

test("hostile inputs and worker time limits fail without storing a file", async () => {
  const zip = await review();
  const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  zip.writeUInt32LE(fileLimits.expandedBytes + 1, central + 24);
  assert.throws(() => checkDocxZip(zip), /size|limit/);
  await assert.rejects(parseInWorker(Buffer.from("A,A\n1,2")), /unique/);
  await assert.rejects(parseInWorker(Buffer.from("A,B\n1")), /row/);
  await assert.rejects(parseInWorker(Buffer.from("A\n1\n"), 1), /too long/);
  await assert.rejects(
    parseInWorker(Buffer.from([0, 1, 2, 3, 4])),
    /not supported/,
  );
});

test("single-column CSV uses the default delimiter without rejecting valid rows", async () => {
  const parsed = await parseInWorker(Buffer.from("Sales\n1\n2\n"));
  assert.equal(parsed.kind, "csv");
  if (parsed.kind !== "csv") assert.fail();
  assert.deepEqual(parsed.rows, [[1], [2]]);
});
