import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { activate, prepare } from "./upgrade.ts";
import { restore } from "./recovery.ts";

process.umask(0o077);
const usage = `Owner-only offline upgrade. Run as the filesystem owner of DATA.
  npm run owner-upgrade -- prepare --data DATA [--source CHECKOUT] [--core core/exact-file.ts ...]
  npm run owner-upgrade -- activate --prepared DATA/operator-upgrades/ID/prepared.json
  npm run owner-upgrade -- restore --journal DATA/operator-upgrades/ID/activation.json
Preparation exports committed HEAD only. Activation and restore require Gaia STOPPED.
No restart or runtime verification is performed. See docs/owner-upgrades.md.\n`;

try {
  const { values, positionals } = parseArgs({
    options: {
      data: { type: "string" },
      source: { type: "string" },
      core: { type: "string", multiple: true },
      prepared: { type: "string" },
      journal: { type: "string" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (values.help) process.stdout.write(usage);
  else {
    if (positionals.length !== 1) throw new Error(usage);
    const mode = positionals[0];
    const required = (value: string | undefined, name: string) => {
      if (!value) throw new Error(`Missing ${name}.\n${usage}`);
      return resolve(value);
    };
    let result: unknown;
    switch (mode) {
      case "prepare":
        if (values.prepared || values.journal) throw new Error(usage);
        result = await prepare({
          source: resolve(values.source ?? "."),
          data: required(values.data, "--data"),
          allowedCore: values.core,
          async record(check) {
            process.stdout.write(`${check}\n`);
          },
        });
        break;
      case "activate":
        if (values.data || values.source || values.core || values.journal)
          throw new Error(usage);
        result = await activate(required(values.prepared, "--prepared"));
        break;
      case "restore":
        if (values.data || values.source || values.core || values.prepared)
          throw new Error(usage);
        result = await restore(required(values.journal, "--journal"));
        break;
      default:
        throw new Error(usage);
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
