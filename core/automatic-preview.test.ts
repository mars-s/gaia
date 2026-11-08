import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("automatic preview timeout or failure is advisory for a many-surface Revert, while the recipe render still gates it", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "core/testing/automatic-preview.mts",
    ],
    { timeout: 60000 },
  );
  process.stdout.write(stdout);
});
