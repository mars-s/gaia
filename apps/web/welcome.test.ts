import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("welcome keeps its capture hook, honest local copy and both plan actions", () => {
 const app = readFileSync(new URL("./app.tsx", import.meta.url), "utf8");
 const welcome = app.slice(app.indexOf('className="welcome-page'), app.indexOf('<ProfileExperience'));
 assert.match(welcome, /id="welcome-title"/);
 assert.match(welcome, /Gaia is an assistant that runs on your own machine. Your\s+conversations and memory stay here./);
 assert.match(welcome, /Continue with ChatGPT/);
 assert.match(welcome, /appearance="white"/);
 assert.match(welcome, /connection.message/);
 assert.match(welcome, /Finish signing in/);
 assert.match(welcome, /Open browser again/);
 assert.match(welcome, /ClaudeSignIn/);
});
