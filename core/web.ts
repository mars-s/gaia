import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

export async function webResource(
  pathname: string,
  {
    data,
    release,
    directory,
  }: { data: string; release: string; directory: string },
) {
  const missing = { status: 404, type: "text/plain", body: "Not found." };
  try {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes("\\") || decoded.includes("\0")) return missing;
    const versioned = /^\/_gaia\/releases\/([a-f0-9]{40})\/(assets\/.+)$/.exec(
      decoded,
    );
    if (decoded.startsWith("/_gaia/") && !versioned) return missing;
    const requestedRelease = versioned?.[1] ?? release;
    const root = await realpath(
      join(
        requestedRelease === release
          ? directory
          : join(data, "releases", requestedRelease),
        "dist/web",
      ),
    );
    const asset = versioned !== null || decoded.startsWith("/assets/");
    let path = resolve(root, versioned ? versioned[2] : "." + decoded);
    if (path !== root && !path.startsWith(root + sep)) return missing;
    try {
      if (!(await stat(path)).isFile()) {
        if (asset) return missing;
        path = join(root, "index.html");
      }
    } catch {
      if (asset) return missing;
      path = join(root, "index.html");
    }
    path = await realpath(path);
    if (!path.startsWith(root + sep)) return missing;
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
    };
    const body = await readFile(path);
    if (extname(path) === ".html") {
      return {
        status: 200,
        type: "text/html",
        body: body
          .toString()
          .replace(
            /(["'])\.?\/assets\//g,
            `$1/_gaia/releases/${requestedRelease}/assets/`,
          ),
      };
    }
    return {
      status: 200,
      type: types[extname(path)] ?? "application/octet-stream",
      body,
    };
  } catch {
    return missing;
  }
}
