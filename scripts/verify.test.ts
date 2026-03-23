import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "verify.mjs");

async function withTempDir<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-verify-runner-test-"));
  try {
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("verify runs custom steps in order and prints the final ok marker", async () => {
  await withTempDir(async (tempDir) => {
    const tracePath = path.join(tempDir, "trace.log");
    const steps = [
      [process.execPath, ["-e", `require('node:fs').appendFileSync(${JSON.stringify(tracePath)}, 'step-1\\n')`]],
      [process.execPath, ["-e", `require('node:fs').appendFileSync(${JSON.stringify(tracePath)}, 'step-2\\n')`]],
    ];

    const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AUTODESIGN_VERIFY_STEPS_JSON: JSON.stringify(steps),
      },
    });

    const trace = await readFile(tracePath, "utf8");
    assert.equal(trace, "step-1\nstep-2\n");
    assert.match(stdout, /\[verify\] ok/);
  });
});

test("verify stops after the first failing step and returns that exit code", async () => {
  await withTempDir(async (tempDir) => {
    const tracePath = path.join(tempDir, "trace.log");
    const steps = [
      [process.execPath, ["-e", `require('node:fs').appendFileSync(${JSON.stringify(tracePath)}, 'step-1\\n')`]],
      [process.execPath, ["-e", "process.exit(7)"]],
      [process.execPath, ["-e", `require('node:fs').appendFileSync(${JSON.stringify(tracePath)}, 'step-3\\n')`]],
    ];

    let failure: any = null;
    try {
      await execFileAsync(process.execPath, [scriptPath], {
        cwd: repoRoot,
        env: {
          ...process.env,
          AUTODESIGN_VERIFY_STEPS_JSON: JSON.stringify(steps),
        },
      });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure, "verify should fail when one of the configured steps exits non-zero");
    const trace = await readFile(tracePath, "utf8");
    assert.equal(trace, "step-1\n");
    assert.equal(failure.code, 7);
  });
});
