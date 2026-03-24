import assert from "node:assert/strict";
import test from "node:test";

import type { PluginNodeSummary } from "../shared/plugin-bridge.js";
import type { ReconstructionJob } from "../shared/reconstruction.js";
import { buildStructureReport } from "./reconstruction-structure-report.js";

function createJob(strategy: ReconstructionJob["input"]["strategy"]): ReconstructionJob {
  return {
    id: "job-1",
    analysisVersion: "test-v1",
    analysisProvider: "heuristic-local",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    lastAppliedAt: null,
    status: "ready",
    approvalState: "approved",
    loopStatus: "idle",
    stopReason: null,
    input: {
      targetSessionId: "session-1",
      targetNodeId: "target-1",
      referenceNodeId: "reference-1",
      goal: "pixel-match",
      strategy,
      maxIterations: 3,
      allowOutpainting: false,
    },
    targetNode: {
      id: "target-1",
      name: "Target",
      type: "FRAME",
      fillable: true,
      fills: [],
      fillStyleId: null,
      width: 200,
      height: 120,
    },
    referenceNode: {
      id: "reference-1",
      name: "Reference",
      type: "RECTANGLE",
      fillable: true,
      fills: ["image"],
      fillStyleId: null,
      width: 200,
      height: 120,
    },
    currentStageId: "apply-rebuild",
    stages: [],
    warnings: [],
    diffScore: null,
    bestDiffScore: null,
    lastImprovement: null,
    fontMatches: [],
    approvedFontChoices: [],
    approvedAssetChoices: [],
    reviewFlags: [],
    applyStatus: "not_applied",
    referenceRaster: null,
    renderedPreview: null,
    diffMetrics: null,
    structureReport: null,
    iterationCount: 0,
    stagnationCount: 0,
    appliedNodeIds: [],
    refineSuggestions: [],
    analysis: {
      previewDataUrl: "data:image/png;base64,preview",
      mimeType: "image/png",
      width: 200,
      height: 120,
      dominantColors: [],
      canonicalFrame: null,
      screenPlane: null,
      layoutRegions: [],
      designSurfaces: [],
      vectorPrimitives: [],
      semanticNodes: [],
      designTokens: null,
      completionPlan: [],
      textCandidates: [],
      textBlocks: [
        {
          id: "text-1",
          bounds: { x: 0, y: 0, width: 0.5, height: 0.1 },
          role: "body",
          content: "Hello",
          inferred: true,
          fontFamily: "Inter",
          fontStyle: null,
          fontWeight: 400,
          fontSize: 16,
          lineHeight: null,
          letterSpacing: null,
          alignment: "left",
          colorHex: "#111111",
        },
      ],
      ocrBlocks: [],
      textStyleHints: [],
      assetCandidates: [],
      completionZones: [],
      deprojectionNotes: [],
      styleHints: {
        theme: "light",
        cornerRadiusHint: 0,
        shadowHint: "none",
        primaryColorHex: null,
        accentColorHex: null,
      },
      uncertainties: [],
    },
    rebuildPlan: {
      previewOnly: false,
      summary: ["test"],
      ops: [],
    },
  } as unknown as ReconstructionJob;
}

function createTargetNode(width: number, height: number): PluginNodeSummary {
  return {
    id: "target-1",
    name: "Rendered",
    type: "FRAME",
    fillable: true,
    fills: [],
    fillStyleId: null,
    width,
    height,
  };
}

test("buildStructureReport flags raster writes in vector-reconstruction plans", () => {
  const job = createJob("vector-reconstruction");
  job.rebuildPlan = {
    previewOnly: false,
    summary: ["vector"],
    ops: [
      { type: "capability", capabilityId: "nodes.create-text", payload: {} },
      { type: "capability", capabilityId: "reconstruction.apply-raster-reference", payload: {} },
    ] as NonNullable<ReconstructionJob["rebuildPlan"]>["ops"],
  };

  const report = buildStructureReport(job, createTargetNode(200, 120));

  assert.equal(report?.passed, false);
  assert.ok(report?.issues.includes("vector-reconstruction 结果中检测到 raster/image-fill 写回。"));
});

test("buildStructureReport flags missing raster base in hybrid-reconstruction plans", () => {
  const job = createJob("hybrid-reconstruction");
  job.rebuildPlan = {
    previewOnly: false,
    summary: ["hybrid"],
    ops: [{ type: "capability", capabilityId: "nodes.create-text", payload: {} }] as NonNullable<
      ReconstructionJob["rebuildPlan"]
    >["ops"],
  };

  const report = buildStructureReport(job, createTargetNode(180, 120));

  assert.equal(report?.passed, false);
  assert.ok(report?.issues.includes("target frame 尺寸发生变化: expected 200x120, actual 180x120"));
  assert.ok(report?.issues.includes("hybrid-reconstruction rebuild plan 没有写入 raster base。"));
});
