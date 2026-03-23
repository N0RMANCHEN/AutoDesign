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
const scriptPath = path.join(repoRoot, "scripts", "build-figma-plugins.mjs");

function sha256(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

async function withTempBuildRoot<T>(run: (rootDir: string) => Promise<T>) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-build-plugins-test-"));
  try {
    await mkdir(path.join(rootDir, "plugins", "fixture", "src"), { recursive: true });
    return await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

async function writePluginFixture(rootDir: string, uiHash = sha256("<html><body>fixture</body></html>\n")) {
  const pluginDir = path.join(rootDir, "plugins", "fixture");
  await writeFile(
    path.join(pluginDir, "manifest.template.json"),
    JSON.stringify(
      {
        name: "Fixture",
        id: "fixture",
        api: "1.0.0",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(pluginDir, "src", "main.ts"),
    'figma.showUI(__html__, { width: 240, height: 120 });\nfigma.notify("fixture");\n',
    "utf8",
  );
  await writeFile(path.join(pluginDir, "src", "ui.html"), "<html><body>fixture</body></html>\n", "utf8");
  await writeFile(
    path.join(pluginDir, "ui.lock.json"),
    JSON.stringify(
      {
        source: "src/ui.html",
        sha256: uiHash,
        policy: "Do not change plugin UI unless the user explicitly requests a UI change.",
        updatedAt: "2026-03-23T00:00:00.000Z",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function buildEnv(rootDir: string) {
  return {
    ...process.env,
    AUTODESIGN_BUILD_ROOT: rootDir,
    AUTODESIGN_PLUGIN_PACKAGES_JSON: JSON.stringify([
      {
        directory: "plugins/fixture",
        entryFile: "src/main.ts",
        uiFile: "src/ui.html",
      },
    ]),
  };
}

test("build_figma_plugins builds dist artifacts for a locked plugin package", async () => {
  await withTempBuildRoot(async (rootDir) => {
    await writePluginFixture(rootDir);

    await execFileAsync(process.execPath, [scriptPath], {
      cwd: rootDir,
      env: buildEnv(rootDir),
    });

    const distDir = path.join(rootDir, "plugins", "fixture", "dist");
    const manifest = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
    const code = await readFile(path.join(distDir, "code.js"), "utf8");
    const ui = await readFile(path.join(distDir, "ui.html"), "utf8");

    assert.equal(manifest.main, "code.js");
    assert.equal(manifest.ui, "ui.html");
    assert.match(code, /figma\.showUI\(__html__/);
    assert.equal(ui, "<html><body>fixture</body></html>\n");
  });
});

test("build_figma_plugins fails when a locked plugin UI drifts without approval", async () => {
  await withTempBuildRoot(async (rootDir) => {
    await writePluginFixture(rootDir, "stalehash");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], {
        cwd: rootDir,
        env: buildEnv(rootDir),
      }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /plugin UI is locked/);
        assert.match(stderr, /plugins\/fixture: plugin UI is locked/);
        return true;
      },
    );
  });
});
