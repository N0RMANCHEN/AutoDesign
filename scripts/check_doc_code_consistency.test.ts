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
const scriptPath = path.join(repoRoot, "scripts", "check_doc_code_consistency.mjs");

async function withTempRepo<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-doc-consistency-test-"));
  try {
    await mkdir(path.join(tempDir, "config", "governance"), { recursive: true });
    await mkdir(path.join(tempDir, "doc"), { recursive: true });
    await mkdir(path.join(tempDir, "reports"), { recursive: true });
    await mkdir(path.join(tempDir, "schemas"), { recursive: true });
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeRules(tempDir: string, overrides: Record<string, unknown> = {}) {
  const rules = {
    requiredDocs: ["README.md", "doc/Guide.md", "reports/README.md"],
    pathReferences: [
      { doc: "README.md", path: "doc/Guide.md" },
      { doc: "reports/README.md", path: "schemas/sample.schema.json" },
    ],
    fieldAssertions: [
      { doc: "README.md", mustContain: "npm run verify" },
      { doc: "doc/Guide.md", mustContain: "governance truth" },
    ],
    ...overrides,
  };
  await writeFile(
    path.join(tempDir, "config", "governance", "doc_code_consistency_rules.json"),
    JSON.stringify(rules, null, 2),
    "utf8",
  );
}

async function writePassingFixture(tempDir: string) {
  await writeFile(path.join(tempDir, "README.md"), "See doc/Guide.md and run npm run verify.", "utf8");
  await writeFile(path.join(tempDir, "doc", "Guide.md"), "This guide defines governance truth for docs.", "utf8");
  await writeFile(path.join(tempDir, "reports", "README.md"), "Reports refer to schemas/sample.schema.json.", "utf8");
  await writeFile(path.join(tempDir, "schemas", "sample.schema.json"), "{\n  \"type\": \"object\"\n}\n", "utf8");
}

test("check_doc_code_consistency passes when required docs, path references and assertions match", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRules(tempDir);
    await writePassingFixture(tempDir);

    const { stdout } = await execFileAsync(process.execPath, [scriptPath], { cwd: tempDir });
    assert.match(stdout, /check:doc-consistency passed/);
  });
});

test("check_doc_code_consistency fails when a referenced target path is missing", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRules(tempDir);
    await writeFile(path.join(tempDir, "README.md"), "See doc/Guide.md and run npm run verify.", "utf8");
    await writeFile(path.join(tempDir, "doc", "Guide.md"), "This guide defines governance truth for docs.", "utf8");
    await writeFile(path.join(tempDir, "reports", "README.md"), "Reports refer to schemas/sample.schema.json.", "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:doc-consistency failed/);
        assert.match(stderr, /pathReferences target missing: schemas\/sample\.schema\.json/);
        return true;
      },
    );
  });
});

test("check_doc_code_consistency fails when a required field assertion drifts", async () => {
  await withTempRepo(async (tempDir) => {
    await writeRules(tempDir);
    await writeFile(path.join(tempDir, "README.md"), "See doc/Guide.md.", "utf8");
    await writeFile(path.join(tempDir, "doc", "Guide.md"), "This guide defines governance truth for docs.", "utf8");
    await writeFile(path.join(tempDir, "reports", "README.md"), "Reports refer to schemas/sample.schema.json.", "utf8");
    await writeFile(path.join(tempDir, "schemas", "sample.schema.json"), "{\n  \"type\": \"object\"\n}\n", "utf8");

    await assert.rejects(
      execFileAsync(process.execPath, [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:doc-consistency failed/);
        assert.match(stderr, /field assertion missing in README\.md: "npm run verify"/);
        return true;
      },
    );
  });
});
