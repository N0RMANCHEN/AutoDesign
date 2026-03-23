import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { PluginNodeSummary } from "../shared/plugin-bridge.js";
import type {
  ReconstructionAcceptanceGate,
  ReconstructionDiffMetrics,
  ReconstructionRasterAsset,
} from "../shared/reconstruction.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeModulePath = path.join(repoRoot, "server", "reconstruction-store.ts");

function createNode(id: string): PluginNodeSummary {
  return {
    id,
    name: id,
    type: "FRAME",
    fillable: true,
    fills: [],
    fillStyleId: null,
    width: 120,
    height: 80,
  };
}

function createReferenceRaster(): ReconstructionRasterAsset {
  return {
    nodeId: "reference-1",
    mimeType: "image/png",
    width: 120,
    height: 80,
    dataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=",
    source: "node-export",
  };
}

function createGate(
  metric: string,
  passed: boolean,
  overrides?: Partial<ReconstructionAcceptanceGate>,
): ReconstructionAcceptanceGate {
  return {
    id: `${metric}-gate`,
    label: metric,
    metric,
    comparator: "gte",
    threshold: 0.9,
    actual: passed ? 0.95 : 0.4,
    passed,
    hard: true,
    ...overrides,
  };
}

function createDiffMetrics(overrides?: Partial<ReconstructionDiffMetrics>): ReconstructionDiffMetrics {
  return {
    globalSimilarity: 0.93,
    colorDelta: 0.08,
    edgeSimilarity: 0.91,
    layoutSimilarity: 0.92,
    structureSimilarity: 0.91,
    hotspotAverage: 0.12,
    hotspotPeak: 0.18,
    hotspotCoverage: 0.2,
    compositeScore: 0.93,
    grade: "A",
    acceptanceGates: [
      createGate("layoutSimilarity", true),
      createGate("colorDelta", true, { comparator: "lte", threshold: 0.15, actual: 0.08 }),
    ],
    hotspots: [],
    ...overrides,
  };
}

async function withTempStore<T>(run: (store: typeof import("./reconstruction-store.js")) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "autodesign-reconstruction-store-"));
  const previousCwd = process.cwd();
  process.chdir(tempDir);
  try {
    const moduleUrl = `${pathToFileURL(storeModulePath).href}?test=${Date.now()}-${Math.random()}`;
    const store = (await import(moduleUrl)) as typeof import("./reconstruction-store.js");
    return await run(store);
  } finally {
    process.chdir(previousCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("createReconstructionJob clamps iterations and initializes the expected default stages", async () => {
  await withTempStore(async (store) => {
    const job = await store.createReconstructionJob(
      {
        targetSessionId: "session-1",
        maxIterations: 99,
      },
      createNode("target-1"),
      createNode("reference-1"),
      ["initial warning"],
    );

    assert.equal(job.input.maxIterations, 20);
    assert.equal(job.input.strategy, "vector-reconstruction");
    assert.equal(job.approvalState, "not-reviewed");
    assert.equal(job.status, "ready");
    assert.equal(job.currentStageId, "extract-reference");
    assert.deepEqual(job.warnings, ["initial warning"]);
    assert.equal(job.stages[0]?.stageId, "validate-input");
    assert.equal(job.stages[0]?.status, "completed");
    assert.match(job.stages[0]?.message ?? "", /输入校验通过/);

    const listed = await store.listReconstructionJobs();
    assert.equal(listed.jobs.length, 1);
    assert.equal(listed.jobs[0]?.id, job.id);

    const loaded = await store.getReconstructionJob(job.id);
    assert.equal(loaded?.id, job.id);
    assert.equal(loaded?.input.targetNodeId, "target-1");
  });
});

test("reconstruction lifecycle persists raster preparation, apply, render, measure and terminal refine state", async () => {
  await withTempStore(async (store) => {
    const job = await store.createReconstructionJob(
      {
        targetSessionId: "session-1",
        strategy: "raster-exact",
        maxIterations: 4,
      },
      createNode("target-1"),
      createNode("reference-1"),
    );

    const prepared = await store.prepareRasterReconstruction(job.id, {
      referenceRaster: createReferenceRaster(),
      warnings: ["prepared raster"],
    });
    assert.equal(prepared?.approvalState, "approved");
    assert.equal(prepared?.analysisVersion, "raster-exact-v1");
    assert.equal(prepared?.currentStageId, "apply-rebuild");
    assert.ok(prepared?.warnings.includes("prepared raster"));

    const applied = await store.markReconstructionApplied(job.id, {
      appliedNodeIds: ["node-a", "node-a", "node-b"],
      warnings: ["apply finished"],
    });
    assert.equal(applied?.applyStatus, "applied");
    assert.deepEqual(applied?.appliedNodeIds, ["node-a", "node-b"]);
    assert.ok(applied?.warnings.includes("apply finished"));
    assert.equal(
      applied?.stages.find((stage) => stage.stageId === "apply-rebuild")?.status,
      "completed",
    );

    const rendered = await store.markReconstructionRendered(job.id, {
      targetNode: createNode("target-2"),
      renderedPreview: {
        previewDataUrl: createReferenceRaster().dataUrl,
        mimeType: "image/png",
        width: 120,
        height: 80,
        capturedAt: "2026-03-23T12:00:00Z",
      },
      structureReport: {
        targetFramePreserved: true,
        imageFillNodeCount: 0,
        textNodeCount: 4,
        vectorNodeCount: 6,
        inferredTextCount: 0,
        passed: true,
        issues: [],
      },
    });
    assert.equal(rendered?.targetNode.id, "target-2");
    assert.equal(rendered?.renderedPreview?.width, 120);
    assert.equal(
      rendered?.stages.find((stage) => stage.stageId === "render-preview")?.status,
      "completed",
    );

    const measured = await store.markReconstructionMeasured(job.id, {
      diffMetrics: createDiffMetrics(),
      warnings: ["measure finished"],
    });
    assert.equal(measured?.diffScore, 0.93);
    assert.equal(measured?.bestDiffScore, 0.93);
    assert.equal(measured?.iterationCount, 1);
    assert.equal(measured?.lastImprovement, null);
    assert.equal(measured?.stagnationCount, 0);
    assert.ok(measured?.warnings.includes("measure finished"));

    const refined = await store.markReconstructionRefined(job.id, {
      refineSuggestions: [
        {
          id: "manual-review-1",
          kind: "manual-review",
          confidence: 0.92,
          message: "当前结果已通过硬门槛。",
          bounds: null,
        },
      ],
    });
    assert.equal(refined?.status, "completed");
    assert.equal(refined?.loopStatus, "stopped");
    assert.equal(refined?.stopReason, "target_reached");
    assert.equal(refined?.currentStageId, "done");
    assert.equal(
      refined?.stages.find((stage) => stage.stageId === "done")?.status,
      "completed",
    );

    const loaded = await store.getReconstructionJob(job.id);
    assert.equal(loaded?.status, "completed");
    assert.equal(loaded?.diffMetrics?.grade, "A");
  });
});

test("analysis review flow updates approval state, rebuild plan font choices and preview-plan approval", async () => {
  await withTempStore(async (store) => {
    const job = await store.createReconstructionJob(
      {
        targetSessionId: "session-1",
        strategy: "vector-reconstruction",
      },
      createNode("target-1"),
      createNode("reference-1"),
    );

    const analyzed = await store.completeReconstructionAnalysis(job.id, {
      analysisVersion: "vector-reconstruction-v1",
      analysisProvider: "codex-assisted",
      analysis: {
        assetCandidates: [],
      } as any,
      fontMatches: [
        {
          textCandidateId: "text-1",
          recommended: "Inter",
          candidates: ["Inter", "SF Pro Display"],
          rationale: "closest match",
        },
      ] as any,
      rebuildPlan: {
        previewOnly: false,
        summary: ["Initial plan"],
        ops: [
          {
            type: "capability",
            capabilityId: "nodes.create-text",
            payload: {
              content: "Hello",
              analysisRefId: "text-1",
              fontFamily: "Inter",
              fontSize: 24,
            },
          },
        ],
      },
      reviewFlags: [
        {
          id: "flag-font",
          kind: "font-review",
          severity: "warning",
          message: "Need final font confirmation",
          targetId: "text-1",
        },
        {
          id: "flag-preview",
          kind: "preview-plan-review",
          severity: "warning",
          message: "Need plan approval",
          targetId: null,
        },
      ],
      warnings: ["analysis complete"],
    });

    assert.equal(analyzed?.approvalState, "pending-review");
    assert.equal(
      analyzed?.stages.find((stage) => stage.stageId === "plan-rebuild")?.status,
      "completed",
    );

    const reviewedFont = await store.reviewReconstructionFontChoice(job.id, {
      textCandidateId: "text-1",
      fontFamily: "SF Pro Display",
    });
    assert.equal(reviewedFont?.approvedFontChoices[0]?.fontFamily, "SF Pro Display");
    assert.equal(
      (reviewedFont?.rebuildPlan?.ops[0]?.payload as Record<string, unknown>)?.fontFamily,
      "SF Pro Display",
    );
    assert.equal(
      reviewedFont?.reviewFlags.some((flag) => flag.kind === "font-review"),
      false,
    );

    const approved = await store.approveReconstructionPlan(job.id, {
      approved: true,
      note: "Preview plan approved",
    });
    assert.equal(approved?.approvalState, "approved");
    assert.equal(
      approved?.reviewFlags.some((flag) => flag.kind === "preview-plan-review"),
      false,
    );
    assert.ok(approved?.warnings.includes("Preview plan approved"));
  });
});
