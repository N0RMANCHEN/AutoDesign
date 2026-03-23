import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "verify-plugin-targeting.mjs");

test("verify_plugin_targeting passes for the current external dispatch invariants", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", scriptPath], {
    cwd: repoRoot,
  });
  assert.match(stdout, /plugin targeting verified/);
});
