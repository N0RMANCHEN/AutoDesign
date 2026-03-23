import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "verify-plugin-ui-lock.mjs");

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

async function withTempPlugin<T>(run: (pluginDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-plugin-ui-lock-test-"));
  const pluginDir = path.join(tempDir, "plugins", "autodesign");
  try {
    await mkdir(path.join(pluginDir, "src"), { recursive: true });
    return await run(pluginDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeUiFixture(pluginDir: string, html: string, lockHash = sha256(html)) {
  await writeFile(path.join(pluginDir, "src", "ui.html"), html, "utf8");
  await writeFile(
    path.join(pluginDir, "ui.lock.json"),
    JSON.stringify(
      {
        source: "src/ui.html",
        sha256: lockHash,
        policy: "Do not change plugin UI unless the user explicitly requests a UI change.",
        updatedAt: "2026-03-23T00:00:00.000Z",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

test("verify_plugin_ui_lock passes when the stored hash matches the current UI source", async () => {
  await withTempPlugin(async (pluginDir) => {
    await writeUiFixture(pluginDir, "<html><body>locked</body></html>\n");

    const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
      env: { ...process.env, AUTODESIGN_PLUGIN_DIR: pluginDir },
    });
    assert.match(stdout, /plugin ui lock verified/);
  });
});

test("verify_plugin_ui_lock fails when the current UI source drifts from the lock hash", async () => {
  await withTempPlugin(async (pluginDir) => {
    await writeUiFixture(pluginDir, "<html><body>locked</body></html>\n", "deadbeef");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], {
        env: { ...process.env, AUTODESIGN_PLUGIN_DIR: pluginDir },
      }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /plugin UI lock mismatch/);
        assert.match(stderr, /expected: deadbeef/);
        return true;
      },
    );
  });
});

test("verify_plugin_ui_lock writes a new lock file when --write is requested", async () => {
  await withTempPlugin(async (pluginDir) => {
    const html = "<html><body>rewrite</body></html>\n";
    await writeUiFixture(pluginDir, html, "stalehash");

    const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--write"], {
      env: { ...process.env, AUTODESIGN_PLUGIN_DIR: pluginDir },
    });
    assert.match(stdout, /plugin ui lock updated:/);

    const lock = JSON.parse(await readFile(path.join(pluginDir, "ui.lock.json"), "utf8"));
    assert.equal(lock.sha256, sha256(html));
    assert.equal(lock.source, "src/ui.html");
    assert.equal(lock.policy, "Do not change plugin UI unless the user explicitly requests a UI change.");
  });
});
