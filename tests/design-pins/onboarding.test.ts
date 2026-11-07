
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";




test("interview offer is a proposal-family card in Gaia’s voice", () => {
 const source = readFileSync(new URL("../../apps/web/profile-panel.tsx", import.meta.url), "utf8");
 assert.match(source, /className="setup-card interview-offer [^"]*rounded-xl border/);
 assert.match(source, /ProposalCardContent title="Fit Gaia around you" status="Optional"/);
 assert.match(source, /Answer three quick questions and Gaia will shape itself around how you work\./);
});
