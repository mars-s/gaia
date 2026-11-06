const authHosts = new Set(["auth.openai.com", "chatgpt.com", "claude.ai"]);

export function externalWebURL(value: unknown): URL {
  if (typeof value !== "string") throw new Error("Expected a web address.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("Only HTTPS web addresses are allowed.");
  }
  return url;
}

export function authURL(value: unknown): string {
  const url = externalWebURL(value);
  if (!authHosts.has(url.hostname))
    throw new Error("Unrecognised sign-in provider.");
  return url.href;
}

export function rendererURL(value: string): URL {
  const url = new URL(value);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "GAIA_DESKTOP_URL must use HTTPS or a loopback HTTP address.",
    );
  }
  return url;
}
