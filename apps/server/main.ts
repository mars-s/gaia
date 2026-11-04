import { resolve, join } from "node:path";
import { chmod } from "node:fs/promises";
import { createAuth } from "./auth.ts";
import { createPi } from "./pi.ts";
import { openDatabase, createChatServer } from "./server.ts";
process.umask(0o077);
const host = process.env.GAIA_HOST ?? "127.0.0.1";
const port = Number(process.env.GAIA_PORT ?? 4318);
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  [8096, 8264, 8090].includes(port)
)
  throw new Error(
    "Choose an available GAIA_PORT other than 8096, 8264 or 8090.",
  );
const dataDir = resolve(process.env.GAIA_DATA_DIR ?? "./data");
const db = await openDatabase(dataDir);
const auth = createAuth(db);
await auth.initialise();
const piPath = join(dataDir, "pi.sqlite");
const adapter = await createPi(piPath, auth);
await chmod(piPath, 0o600);
const webPort = Number(process.env.GAIA_WEB_PORT ?? 4317);
const origins = process.env.GAIA_ORIGINS?.split(",") ?? [
  `http://${host}:${port}`,
  `http://localhost:${port}`,
  `http://127.0.0.1:${webPort}`,
  `http://localhost:${webPort}`,
];
const app = createChatServer({ db, adapter, auth, origins });
app.server.listen(port, host, () =>
  process.stdout.write(
    `Gaia API http://${host}:${port}\nGaia chat http://127.0.0.1:${webPort}\n`,
  ),
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void app.close().then(() => process.exit(0));
  });
