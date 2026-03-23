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
const scriptPath = path.join(repoRoot, "scripts", "check_architecture_governance.mjs");

async function withTempRepo<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-architecture-governance-test-"));
  try {
    await mkdir(path.join(tempDir, "config", "governance"), { recursive: true });
    await mkdir(path.join(tempDir, "doc"), { recursive: true });
    await mkdir(path.join(tempDir, "shared"), { recursive: true });
    await mkdir(path.join(tempDir, "server"), { recursive: true });
    await mkdir(path.join(tempDir, "plugins", "autodesign"), { recursive: true });
    await mkdir(path.join(tempDir, "scripts"), { recursive: true });
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeRules(tempDir: string) {
  const rules = {
    requiredDocs: ["README.md", "doc/Guide.md"],
    requiredDirs: ["shared", "server", "plugins/autodesign", "scripts"],
    maxFileLines: { default: 10, hard: 20 },
    dependencyRules: [
      { scope: "shared", forbid: ["../server/"] },
      { scope: "server", forbid: ["../plugins/"] },
      { scope: "plugins", forbid: ["../../server/"] },
    ],
  };
  await writeFile(
    path.join(tempDir, "config", "governance", "architecture_rules.json"),
    JSON.stringify(rules, null, 2),
    "utf8",
  );
}

async function writeCommonFixture(tempDir: string) {
  await writeFile(path.join(tempDir, "README.md"), "# Repo\n", "utf8");
  await writeFile(path.join(tempDir, "doc", "Guide.md"), "# Guide\n", "utf8");
  await writeFile(path.join(tempDir, "shared", "local.ts"), "export const local = 1;\n", "utf8");
  await writeFile(path.join(tempDir, "server", "local.ts"), "export const local = 1;\n", "utf8");
  await writeFile(path.join(tempDir, "plugins", "autodesign", "local.ts"), "export const local = 1;\n", "utf8");
}

test("check_architecture_governance passes when required docs, dirs and dependency edges are valid", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRules(tempDir);
    await writeCommonFixture(tempDir);
    await writeFile(path.join(tempDir, "shared", "ok.ts"), 'import "./local";\nexport const value = local;\n', "utf8");
    await writeFile(path.join(tempDir, "server", "ok.ts"), 'import "./local";\nexport const value = local;\n', "utf8");
    await writeFile(path.join(tempDir, "plugins", "autodesign", "ok.ts"), 'import "./local";\nexport const value = local;\n', "utf8");

    const { stdout } = await execFileAsync(process.execPath, [scriptPath], { cwd: tempDir });
    assert.match(stdout, /governance:check passed/);
  });
});

test("check_architecture_governance fails when a forbidden dependency edge appears", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRules(tempDir);
    await writeCommonFixture(tempDir);
    await writeFile(path.join(tempDir, "shared", "bad.ts"), 'import "../server/local";\nexport const value = 1;\n', "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /governance:check failed/);
        assert.match(stderr, /forbidden dependency edge in shared\/bad\.ts: \.\.\/server\/local/);
        return true;
      },
    );
  });
});

test("check_architecture_governance fails when a file exceeds the hard line limit", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRules(tempDir);
    await writeCommonFixture(tempDir);
    const oversized = `${Array.from({ length: 21 }, (_, index) => `export const line${index} = ${index};`).join("\n")}\n`;
    await writeFile(path.join(tempDir, "server", "huge.ts"), oversized, "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /governance:check failed/);
        assert.match(stderr, /hard line-limit exceeded: server\/huge\.ts \(22 > 20\)/);
        return true;
      },
    );
  });
});
