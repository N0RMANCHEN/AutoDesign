import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "verify-plugin-smoke.mjs");

async function withTempDist<T>(run: (distDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-plugin-smoke-test-"));
  const distDir = path.join(tempDir, "plugins", "autodesign", "dist");
  try {
    await mkdir(distDir, { recursive: true });
    return await run(distDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeDistFixture(distDir: string, code = 'figma.showUI(__html__, { width: 240, height: 120 });\n') {
  await writeFile(
    path.join(distDir, "manifest.json"),
    JSON.stringify(
      {
        name: "AutoDesign",
        id: "autodesign",
        api: "1.0.0",
        main: "code.js",
        ui: "ui.html",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(path.join(distDir, "code.js"), code, "utf8");
}

test("verify_plugin_smoke passes for valid dist artifacts and current natural-language mappings", async () => {
  await withTempDist(async (distDir) => {
    await writeDistFixture(distDir);

    const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", scriptPath], {
      env: { ...process.env, AUTODESIGN_PLUGIN_DIST_DIR: distDir },
    });
    assert.match(stdout, /plugin smoke passed/);
  });
});

test("verify_plugin_smoke fails when dist code stops using __html__ for showUI", async () => {
  await withTempDist(async (distDir) => {
    await writeDistFixture(distDir, 'figma.showUI("manual-html", { width: 240, height: 120 });\n');

    await assert.rejects(
      execFileAsync(process.execPath, ["--import", "tsx", scriptPath], {
        env: { ...process.env, AUTODESIGN_PLUGIN_DIST_DIR: distDir },
      }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /plugins\/autodesign code\.js must use __html__\./);
        return true;
      },
    );
  });
});
