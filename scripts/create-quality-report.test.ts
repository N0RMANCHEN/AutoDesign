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
const scriptPath = path.join(repoRoot, "scripts", "create-quality-report.mjs");

async function withTempRoot<T>(run: (tempRoot: string) => Promise<T>) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-quality-report-"));
  try {
    return await run(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

test("create_quality_report scaffolds markdown and json files for the reconstruction measure preset", async () => {
  await withTempRoot(async (tempRoot) => {
    const timestamp = "20260325-160000";
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, "--timestamp", timestamp, "--owner", "hirohi"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AUTODESIGN_REPORT_ROOT: tempRoot,
        },
      },
    );

    const markdownPath = path.join(tempRoot, "reports", "quality", `quality-${timestamp}.md`);
    const jsonPath = path.join(tempRoot, "reports", "quality", `quality-${timestamp}.json`);
    const markdown = await readFile(markdownPath, "utf8");
    const payload = JSON.parse(await readFile(jsonPath, "utf8"));

    assert.match(stdout, /quality report created: reports\/quality\/quality-20260325-160000\.md/);
    assert.equal(payload.kind, "quality_report");
    assert.equal(payload.timestamp, timestamp);
    assert.equal(payload.owner, "hirohi");
    assert.equal(payload.scope, "Reconstruction quality measurement");
    assert.match(payload.measurements[0], /composite score/);
    assert.deepEqual(payload.artifacts, []);
    assert.match(markdown, /## Measurements/);
    assert.match(markdown, /Pending capture\./);
  });
});

test("create_quality_report supports repeated custom fields and rejects duplicate timestamps", async () => {
  await withTempRoot(async (tempRoot) => {
    const timestamp = "20260325-160500";
    await execFileAsync(
      process.execPath,
      [
        scriptPath,
        "--timestamp",
        timestamp,
        "--scenario",
        "workflow-regression",
        "--owner",
        "Codex",
        "--input",
        "plugin:reconstruct --measure",
        "--input",
        "job-hybrid",
        "--measurement",
        "composite=0.91",
        "--finding",
        "No regression detected in fail-fast path ordering.",
        "--artifact",
        "reports/acceptance/acceptance-20260325-160500.md",
        "--follow-up",
        "Promote the workflow to live acceptance.",
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AUTODESIGN_REPORT_ROOT: tempRoot,
        },
      },
    );

    const jsonPath = path.join(tempRoot, "reports", "quality", `quality-${timestamp}.json`);
    const payload = JSON.parse(await readFile(jsonPath, "utf8"));
    assert.equal(payload.scope, "Workflow regression review");
    assert.deepEqual(payload.inputs, ["plugin:reconstruct --measure", "job-hybrid"]);
    assert.deepEqual(payload.measurements, ["composite=0.91"]);
    assert.deepEqual(payload.findings, ["No regression detected in fail-fast path ordering."]);
    assert.deepEqual(payload.artifacts, ["reports/acceptance/acceptance-20260325-160500.md"]);
    assert.deepEqual(payload.follow_up, ["Promote the workflow to live acceptance."]);

    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [scriptPath, "--timestamp", timestamp], {
          cwd: repoRoot,
          env: {
            ...process.env,
            AUTODESIGN_REPORT_ROOT: tempRoot,
          },
        }),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Quality report already exists/);
        return true;
      },
    );
  });
});
