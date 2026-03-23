import assert from "node:assert/strict";
import test from "node:test";

import {
  RECONSTRUCTION_ANALYSIS_VERSION_CODEX,
  buildNormalizedReconstructionAnalysis,
  buildReconstructionContextPack,
} from "./reconstruction-analysis.js";
import type { ReconstructionJob } from "../shared/reconstruction.js";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=";

function createNode(id: string, previewDataUrl: string | null = PNG_DATA_URL) {
  return {
    id,
    name: id,
    type: "FRAME",
    fillable: true,
    fills: [],
    fillStyleId: null,
    width: 160,
    height: 100,
    previewDataUrl,
  };
}

function createJob(strategy: ReconstructionJob["input"]["strategy"]): ReconstructionJob {
  return {
    id: `job-${strategy}`,
    analysisVersion: "test",
    analysisProvider: "heuristic-local",
    input: {
      targetSessionId: "session-1",
      targetNodeId: "target-1",
      referenceNodeId: "reference-1",
      goal: "pixel-match",
      strategy,
      maxIterations: 4,
      allowOutpainting: strategy === "hybrid-reconstruction",
    },
    status: "ready",
    applyStatus: "not_applied",
    loopStatus: "idle",
    stopReason: null,
    approvalState: "not-reviewed",
    currentStageId: "analyze-layout",
    createdAt: "2026-03-23T00:00:00.000Z",
    updatedAt: "2026-03-23T00:00:00.000Z",
    completedAt: null,
    lastAppliedAt: null,
    diffScore: null,
    bestDiffScore: null,
    lastImprovement: null,
    stagnationCount: 0,
    warnings: ["existing warning"],
    targetNode: createNode("target-1", PNG_DATA_URL),
    referenceNode: createNode("reference-1", PNG_DATA_URL),
    referenceRaster: null,
    analysis: null,
    fontMatches: [],
    rebuildPlan: null,
    reviewFlags: [],
    approvedFontChoices: [],
    approvedAssetChoices: [],
    renderedPreview: null,
    diffMetrics: null,
    structureReport: null,
    refineSuggestions: [],
    iterationCount: 0,
    appliedNodeIds: [],
    stages: [],
  };
}

test("buildReconstructionContextPack exposes current warnings and strategy-specific guidance", () => {
  const job = createJob("vector-reconstruction");
  const pack = buildReconstructionContextPack(job);

  assert.equal(pack.jobId, job.id);
  assert.equal(pack.mode, "codex-assisted");
  assert.equal(pack.analysisVersionTarget, RECONSTRUCTION_ANALYSIS_VERSION_CODEX);
  assert.equal(pack.referencePreviewDataUrl, PNG_DATA_URL);
  assert.deepEqual(pack.currentWarnings, ["existing warning"]);
  assert.ok(pack.workflow.length >= 4);
  assert.ok(pack.scoringRubric.some((item) => item.includes("compositeScore")));
  assert.ok(pack.guidance.some((item) => item.includes("固定 target frame")));
});

test("buildReconstructionContextPack rejects jobs without reference previews", () => {
  const job = createJob("vector-reconstruction");
  job.referenceNode = createNode("reference-1", null);

  assert.throws(
    () => buildReconstructionContextPack(job),
    /参考节点缺少 previewDataUrl/,
  );
});

test("buildNormalizedReconstructionAnalysis adds vector strategy warnings when canonical frame facts are missing", () => {
  const job = createJob("vector-reconstruction");
  const normalized = buildNormalizedReconstructionAnalysis(job, {
    analysis: {
      textBlocks: [
        {
          id: "text-1",
          bounds: { x: 10, y: 12, width: 80, height: 24 },
          role: "headline",
          content: "Hello",
          inferred: false,
          fontFamily: "Inter",
          fontStyle: "Regular",
          fontWeight: 400,
          fontSize: 24,
          lineHeight: 28,
          letterSpacing: 0,
          alignment: "left",
          colorHex: "#111111",
        },
      ],
    },
    warnings: ["input warning"],
  });

  assert.equal(normalized.analysisVersion, RECONSTRUCTION_ANALYSIS_VERSION_CODEX);
  assert.equal(normalized.analysisProvider, "heuristic-local");
  assert.equal(normalized.analysis.previewDataUrl, PNG_DATA_URL);
  assert.equal(normalized.analysis.mimeType, "image/png");
  assert.equal(normalized.analysis.width, 160);
  assert.equal(normalized.analysis.height, 100);
  assert.equal(normalized.analysis.canonicalFrame?.fixedTargetFrame, true);
  assert.equal(normalized.analysis.canonicalFrame?.deprojected, true);
  assert.ok(normalized.analysis.textCandidates.length >= 1);
  assert.ok(normalized.rebuildPlan.summary.length >= 1);
  assert.ok(normalized.warnings.includes("input warning"));
  assert.ok(
    normalized.warnings.includes("vector-reconstruction 当前缺少 rectified screen preview；后续评分仍可能偏向原始透视截图。"),
  );
});

test("buildNormalizedReconstructionAnalysis adds hybrid warnings for missing sourceQuad, asset candidates and completion zones", () => {
  const job = createJob("hybrid-reconstruction");
  const normalized = buildNormalizedReconstructionAnalysis(job, {
    analysisProvider: "codex-assisted",
    analysisVersion: "custom-analysis-v1",
    analysis: {
      canonicalFrame: {
        width: 160,
        height: 100,
        fixedTargetFrame: false,
        deprojected: true,
        mappingMode: "extend",
      },
    },
  });

  assert.equal(normalized.analysisVersion, "custom-analysis-v1");
  assert.equal(normalized.analysisProvider, "codex-assisted");
  assert.ok(
    normalized.warnings.includes("hybrid-reconstruction 应保持 target frame 固定，当前 canonicalFrame 未明确固定。"),
  );
  assert.ok(
    normalized.warnings.includes("hybrid-reconstruction 标记了 deprojected=true，但 canonicalFrame.sourceQuad 缺失；当前只能做固定 frame 映射，不能做真实平面拉正。"),
  );
  assert.ok(
    normalized.warnings.includes("hybrid-reconstruction 当前没有资产/材质切片候选，材质区域很可能只能依赖 raster base。"),
  );
  assert.ok(
    normalized.warnings.includes("allowOutpainting 已开启，但当前 analysis 没有声明 completionZones。"),
  );
});
