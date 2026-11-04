import assert from "node:assert/strict";
import { test } from "node:test";
import { authURL, externalWebURL, rendererURL } from "./urls.ts";

test("auth opens only HTTPS provider hosts, without credentials or custom ports", () => {
  assert.equal(
    authURL("https://auth.openai.com/oauth/authorize?state=example"),
    "https://auth.openai.com/oauth/authorize?state=example",
  );
  assert.equal(
    authURL("https://chatgpt.com/auth/login"),
    "https://chatgpt.com/auth/login",
  );
  for (const value of [
    undefined,
    {},
    "http://auth.openai.com/",
    "https://auth.openai.com.evil.test/",
    "https://auth.openai.com@evil.test/",
    "https://user@auth.openai.com/",
    "https://auth.openai.com:8443/",
    "file:///tmp/test",
    "javascript:alert(1)",
    "https://example.com/",
  ]) {
    assert.throws(() => authURL(value));
  }
});

test("external navigation permits web links but never OS protocols", () => {
  assert.equal(
    externalWebURL("https://example.com/help").hostname,
    "example.com",
  );
  for (const value of [
    "file:///tmp/test",
    "mailto:a@example.com",
    "vscode://file/test",
    "http://example.com/",
    "https://user:password@example.com/",
  ]) {
    assert.throws(() => externalWebURL(value));
  }
});

test("desktop renderer accepts local dev or managed port, and TLS deployments", () => {
  for (const value of [
    "http://127.0.0.1:4317",
    "http://127.0.0.1:4319",
    "http://[::1]:4317",
    "https://gaia.example.com/",
  ]) {
    assert.equal(rendererURL(value).origin, new URL(value).origin);
  }
  for (const value of [
    "http://gaia.example.com",
    "file:///tmp/index.html",
    "javascript:alert(1)",
    "https://user:password@gaia.example.com/",
  ]) {
    assert.throws(() => rendererURL(value));
  }
});
