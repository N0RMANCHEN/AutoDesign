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
const scriptPath = path.join(repoRoot, "scripts", "check_runtime_write_surfaces.mjs");

async function withTempRepo<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-runtime-write-surfaces-test-"));
  try {
    await mkdir(path.join(tempDir, "config", "governance"), { recursive: true });
    await mkdir(path.join(tempDir, "plugins", "autodesign", "src"), { recursive: true });
    await mkdir(path.join(tempDir, "server"), { recursive: true });
    await mkdir(path.join(tempDir, "shared"), { recursive: true });
    await mkdir(path.join(tempDir, "scripts"), { recursive: true });
    await mkdir(path.join(tempDir, "data"), { recursive: true });
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeRegistry(tempDir: string) {
  const registry = {
    figmaApiAllowedGlobs: ["plugins/autodesign/src/*.ts", "plugins/autodesign/src/**/*.ts"],
    truthStores: [
      {
        id: "project_store",
        path: "data/autodesign-project.json",
        allowedWriters: ["server/storage.ts"],
      },
    ],
  };
  await writeFile(
    path.join(tempDir, "config", "governance", "runtime_write_registry.json"),
    JSON.stringify(registry, null, 2),
    "utf8",
  );
}

test("check_runtime_write_surfaces passes for allowed figma runtime usage and authorized truth-store writers", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRegistry(tempDir);
    await writeFile(path.join(tempDir, "plugins", "autodesign", "src", "main.ts"), "figma.currentPage;\n", "utf8");
    await writeFile(
      path.join(tempDir, "server", "storage.ts"),
      'import { writeFile } from "node:fs/promises";\nconst target = "data/autodesign-project.json";\nawait writeFile(target, "{}");\n',
      "utf8",
    );
    await writeFile(
      path.join(tempDir, "shared", "notes.ts"),
      '// figma.currentPage should be ignored in comments\nconst example = "figma.currentPage";\nexport const value = example;\n',
      "utf8",
    );

    const { stdout } = await execFileAsync(process.execPath, [scriptPath], { cwd: tempDir });
    assert.match(stdout, /check:runtime-write-surfaces passed/);
  });
});

test("check_runtime_write_surfaces fails when figma API usage leaks outside plugin runtime", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRegistry(tempDir);
    await writeFile(path.join(tempDir, "server", "bad.ts"), "export function leak() { return figma.currentPage; }\n", "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:runtime-write-surfaces failed/);
        assert.match(stderr, /figma API usage outside plugin runtime: server\/bad\.ts/);
        return true;
      },
    );
  });
});

test("check_runtime_write_surfaces fails when a non-owner file writes a truth store", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRegistry(tempDir);
    await writeFile(
      path.join(tempDir, "scripts", "bad.ts"),
      'import { writeFile } from "node:fs/promises";\nawait writeFile("data/autodesign-project.json", "{}");\n',
      "utf8",
    );

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:runtime-write-surfaces failed/);
        assert.match(stderr, /unauthorized truth-store writer for data\/autodesign-project\.json: scripts\/bad\.ts/);
        return true;
      },
    );
  });
});
