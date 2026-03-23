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
const scriptPath = path.join(repoRoot, "scripts", "check_report_schemas.mjs");

async function withTempRepo<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-report-schema-test-"));
  try {
    await mkdir(path.join(tempDir, "schemas"), { recursive: true });
    await mkdir(path.join(tempDir, "reports", "acceptance"), { recursive: true });
    await mkdir(path.join(tempDir, "reports", "quality"), { recursive: true });
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeBaseSchemas(tempDir: string) {
  await writeFile(
    path.join(tempDir, "schemas", "acceptance-report.schema.json"),
    JSON.stringify(
      {
        type: "object",
        required: ["kind", "timestamp", "status", "scope", "owner", "scenario", "steps", "observations"],
        properties: {
          kind: { const: "acceptance_report", type: "string" },
          timestamp: { type: "string", pattern: "^[0-9]{8}-[0-9]{6}$" },
          status: { type: "string", enum: ["PASS", "FAIL"] },
          scope: { type: "string", minLength: 1 },
          owner: { type: "string", minLength: 1 },
          scenario: { type: "string", minLength: 1 },
          steps: { type: "array", minItems: 1, items: { type: "string" } },
          observations: { type: "array", minItems: 1, items: { type: "string" } },
        },
        additionalProperties: false,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(tempDir, "schemas", "quality-report.schema.json"),
    JSON.stringify(
      {
        type: "object",
        required: ["kind", "timestamp", "scope", "owner", "inputs", "measurements", "findings"],
        properties: {
          kind: { const: "quality_report", type: "string" },
          timestamp: { type: "string", pattern: "^[0-9]{8}-[0-9]{6}$" },
          scope: { type: "string", minLength: 1 },
          owner: { type: "string", minLength: 1 },
          inputs: { type: "array", minItems: 1, items: { type: "string" } },
          measurements: { type: "array", minItems: 1, items: { type: "string" } },
          findings: { type: "array", minItems: 1, items: { type: "string" } },
        },
        additionalProperties: false,
      },
      null,
      2,
    ),
    "utf8",
  );
}

test("check_report_schemas passes for valid acceptance and quality reports", async () => {
  await withTempRepo(async (tempDir) => {
    await writeBaseSchemas(tempDir);
    await writeFile(
      path.join(tempDir, "reports", "acceptance", "acceptance-20260101-000000.json"),
      JSON.stringify(
        {
          kind: "acceptance_report",
          timestamp: "20260101-000000",
          status: "PASS",
          scope: "acceptance scope",
          owner: "Codex",
          scenario: "validate acceptance report",
          steps: ["step 1"],
          observations: ["all good"],
        },
        null,
        2,
      ),
      "utf8",
    );
    await writeFile(
      path.join(tempDir, "reports", "quality", "quality-20260101-000000.json"),
      JSON.stringify(
        {
          kind: "quality_report",
          timestamp: "20260101-000000",
          scope: "quality scope",
          owner: "Codex",
          inputs: ["input A"],
          measurements: ["measurement A"],
          findings: ["finding A"],
        },
        null,
        2,
      ),
      "utf8",
    );

    const { stdout } = await execFileAsync("node", [scriptPath], { cwd: tempDir });
    assert.match(stdout, /check:report-schemas passed/);
  });
});

test("check_report_schemas fails for invalid report payloads", async () => {
  await withTempRepo(async (tempDir) => {
    await writeBaseSchemas(tempDir);
    await writeFile(
      path.join(tempDir, "reports", "acceptance", "acceptance-bad.json"),
      JSON.stringify(
        {
          kind: "acceptance_report",
          timestamp: "bad-timestamp",
          status: "PASS",
          scope: "acceptance scope",
          owner: "Codex",
          scenario: "validate acceptance report",
          steps: [],
          observations: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    await assert.rejects(
      execFileAsync("node", [scriptPath], { cwd: tempDir }),
      (error: any) => {
        const stderr = String(error.stderr || "");
        assert.match(stderr, /check:report-schemas failed/);
        assert.match(stderr, /does not match pattern/);
        assert.match(stderr, /must have at least 1 items/);
        return true;
      },
    );
  });
});
