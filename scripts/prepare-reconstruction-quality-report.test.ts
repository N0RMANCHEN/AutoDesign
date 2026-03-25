import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "prepare-reconstruction-quality-report.mjs");

function pngDataUrl(contents: string) {
  return `data:image/png;base64,${Buffer.from(contents, "utf8").toString("base64")}`;
}

async function withTempRoot<T>(run: (tempRoot: string, fixtureDir: string) => Promise<T>) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "autodesign-quality-prepare-"));
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-quality-prepare-fixture-"));
  try {
    return await run(tempRoot, fixtureDir);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

test("prepare_reconstruction_quality_report writes a measured quality report and artifacts", async () => {
  await withTempRoot(async (tempRoot, fixtureDir) => {
    const timestamp = "20260325-231500";
    await writeFile(
      path.join(fixtureDir, "get__api__reconstruction__jobs__job-hybrid.json"),
      JSON.stringify(
        {
          id: "job-hybrid",
          input: {
            strategy: "hybrid-reconstruction",
          },
          status: "ready",
          applyStatus: "applied",
          loopStatus: "idle",
          stopReason: null,
          currentStageId: "measure-diff",
          targetNode: {
            id: "8:30",
            name: "Target Frame",
            type: "FRAME",
          },
          referenceNode: {
            id: "8:31",
            name: "Reference Frame",
            type: "FRAME",
            previewDataUrl: pngDataUrl("reference-preview"),
          },
          referenceRaster: null,
          analysis: {
            previewDataUrl: pngDataUrl("analysis-preview"),
          },
          renderedPreview: {
            previewDataUrl: pngDataUrl("rendered-preview"),
          },
          diffMetrics: {
            compositeScore: 0.91,
            grade: "A",
            globalSimilarity: 0.92,
            layoutSimilarity: 0.93,
            structureSimilarity: 0.91,
            edgeSimilarity: 0.9,
            colorDelta: 0.08,
            hotspotAverage: 0.12,
            hotspotPeak: 0.18,
            hotspotCoverage: 0.2,
            acceptanceGates: [
              {
                id: "gate-composite",
                label: "Composite score",
                metric: "compositeScore",
                comparator: "gte",
                threshold: 0.9,
                actual: 0.91,
                passed: true,
                hard: true,
              },
              {
                id: "gate-hotspot-coverage",
                label: "Hotspot coverage",
                metric: "hotspotCoverage",
                comparator: "lte",
                threshold: 0.18,
                actual: 0.2,
                passed: false,
                hard: false,
              },
            ],
            hotspots: [
              {
                id: "hotspot-1",
                score: 0.18,
                bounds: { x: 24, y: 16, width: 80, height: 44 },
              },
            ],
          },
          structureReport: {
            targetFramePreserved: true,
            imageFillNodeCount: 0,
            textNodeCount: 6,
            vectorNodeCount: 10,
            inferredTextCount: 0,
            passed: true,
            issues: [],
          },
          refineSuggestions: [
            {
              id: "refine-1",
              kind: "nudge-layout",
              confidence: 0.77,
              message: "Tighten the hero card padding near the top hotspot.",
              bounds: null,
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, "--job", "job-hybrid", "--timestamp", timestamp, "--owner", "hirohi"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          AUTODESIGN_REPORT_ROOT: tempRoot,
          AUTODESIGN_API_FIXTURE_DIR: fixtureDir,
        },
      },
    );

    const reportJson = JSON.parse(
      await readFile(path.join(tempRoot, "reports", "quality", `quality-${timestamp}.json`), "utf8"),
    );
    const reportMarkdown = await readFile(
      path.join(tempRoot, "reports", "quality", `quality-${timestamp}.md`),
      "utf8",
    );
    const summary = await readFile(
      path.join(tempRoot, "reports", "quality", "artifacts", timestamp, "quality-summary.txt"),
      "utf8",
    );

    assert.equal(reportJson.owner, "hirohi");
    assert.equal(reportJson.scope, "Reconstruction quality measurement");
    assert.equal(reportJson.inputs[0], "reconstruction job job-hybrid");
    assert.match(reportJson.measurements[1], /composite=0\.9100 grade=A/);
    assert.match(reportJson.findings[0], /Only soft acceptance gates remain/);
    assert.deepEqual(reportJson.artifacts, [
      `reports/quality/artifacts/${timestamp}/quality-summary.txt`,
      `reports/quality/artifacts/${timestamp}/job-hybrid-snapshot.json`,
      `reports/quality/artifacts/${timestamp}/job-hybrid-reference.png`,
      `reports/quality/artifacts/${timestamp}/job-hybrid-rendered.png`,
    ]);
    assert.match(reportMarkdown, /## Measurements/);
    assert.match(summary, /job: job-hybrid/);
    assert.match(summary, /failedGates: 1/);
    assert.match(stdout, /\[quality:prep] ready/);
    assert.match(stdout, /reports\/quality\/quality-20260325-231500\.md/);
  });
});

test("prepare_reconstruction_quality_report rejects jobs that have not been measured yet", async () => {
  await withTempRoot(async (tempRoot, fixtureDir) => {
    const timestamp = "20260325-231900";
    await writeFile(
      path.join(fixtureDir, "get__api__reconstruction__jobs__job-pending.json"),
      JSON.stringify(
        {
          id: "job-pending",
          input: {
            strategy: "hybrid-reconstruction",
          },
          diffMetrics: null,
        },
        null,
        2,
      ),
      "utf8",
    );

    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [scriptPath, "--job", "job-pending", "--timestamp", timestamp], {
          cwd: repoRoot,
          env: {
            ...process.env,
            AUTODESIGN_REPORT_ROOT: tempRoot,
            AUTODESIGN_API_FIXTURE_DIR: fixtureDir,
          },
        }),
      (error: Error & { stderr?: string }) => {
        assert.match(String(error.stderr || ""), /Reconstruction job has no diff metrics yet/);
        return true;
      },
    );

    await assert.rejects(() =>
      readFile(path.join(tempRoot, "reports", "quality", `quality-${timestamp}.json`), "utf8")
    );
  });
});
