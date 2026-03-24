import assert from "node:assert/strict";
import test from "node:test";

import type { PluginNodeSummary } from "../shared/plugin-bridge.js";
import type {
  ReconstructionAcceptanceGate,
  ReconstructionDiffMetrics,
  ReconstructionJob,
  ReconstructionRefineSuggestion,
} from "../shared/reconstruction.js";
import {
  buildLoopStatusReconstructionJob,
  buildMeasuredReconstructionJob,
  buildRefinedReconstructionJob,
} from "./reconstruction-lifecycle.js";
import { createEmptyReconstructionStages } from "./reconstruction-state.js";

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

function createBaseJob(overrides?: Partial<ReconstructionJob>): ReconstructionJob {
  return {
    id: "job-1",
    analysisVersion: "vector-reconstruction-v1",
    analysisProvider: "codex-assisted",
    input: {
      targetSessionId: "session-1",
      targetNodeId: "target-1",
      referenceNodeId: "reference-1",
      goal: "pixel-match",
      strategy: "vector-reconstruction",
      maxIterations: 4,
      allowOutpainting: false,
    },
    status: "ready",
    applyStatus: "applied",
    loopStatus: "idle",
    stopReason: null,
    approvalState: "approved",
    currentStageId: "measure-diff",
    createdAt: "2026-03-24T00:00:00Z",
    updatedAt: "2026-03-24T00:00:00Z",
    completedAt: null,
    lastAppliedAt: "2026-03-24T00:00:00Z",
    diffScore: 0.91,
    bestDiffScore: 0.91,
    lastImprovement: null,
    stagnationCount: 0,
    warnings: [],
    targetNode: createNode("target-1"),
    referenceNode: createNode("reference-1"),
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
    iterationCount: 1,
    appliedNodeIds: ["node-a"],
    stages: createEmptyReconstructionStages(),
    ...overrides,
  };
}

test("buildMeasuredReconstructionJob records rejection notes for non-improving passes", () => {
  const nextJob = buildMeasuredReconstructionJob(
    createBaseJob(),
    {
      diffMetrics: createDiffMetrics({
        compositeScore: 0.905,
        grade: "B",
      }),
    },
    "2026-03-24T01:00:00Z",
  );

  assert.equal(nextJob.lastImprovement, -0.0050000000000000044);
  assert.equal(nextJob.stagnationCount, 1);
  assert.ok(nextJob.warnings.includes("当前 pass 提升未达到自动接受阈值。"));
  assert.equal(nextJob.currentStageId, "measure-diff");
});

test("buildRefinedReconstructionJob completes the loop when target is reached", () => {
  const suggestions: ReconstructionRefineSuggestion[] = [
    {
      id: "manual-review-1",
      kind: "manual-review",
      confidence: 0.92,
      message: "当前结果已通过硬门槛。",
      bounds: null,
    },
  ];

  const nextJob = buildRefinedReconstructionJob(
    createBaseJob({
      diffMetrics: createDiffMetrics({
        compositeScore: 0.93,
        grade: "A",
      }),
    }),
    { refineSuggestions: suggestions },
    "2026-03-24T02:00:00Z",
  );

  assert.equal(nextJob.status, "completed");
  assert.equal(nextJob.loopStatus, "stopped");
  assert.equal(nextJob.stopReason, "target_reached");
  assert.equal(nextJob.currentStageId, "done");
  assert.equal(nextJob.stages.find((stage) => stage.stageId === "done")?.status, "completed");
});

test("buildLoopStatusReconstructionJob writes the terminal stop message into the done stage", () => {
  const nextJob = buildLoopStatusReconstructionJob(
    createBaseJob({
      currentStageId: "refine",
      loopStatus: "running",
    }),
    {
      loopStatus: "stopped",
      stopReason: "stalled",
      warnings: ["loop stopped"],
    },
    "2026-03-24T03:00:00Z",
  );

  assert.equal(nextJob.status, "completed");
  assert.equal(nextJob.loopStatus, "stopped");
  assert.equal(nextJob.stopReason, "stalled");
  assert.ok(nextJob.warnings.includes("loop stopped"));
  assert.match(nextJob.stages.find((stage) => stage.stageId === "done")?.message ?? "", /停止|停机|建议/);
});
