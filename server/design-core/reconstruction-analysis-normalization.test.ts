import assert from "node:assert/strict";
import test from "node:test";

import type { ReconstructionJob } from "../../shared/reconstruction.js";
import {
  normalizeReconstructionAnalysisPayload,
  normalizeReconstructionFontMatches,
  normalizeReconstructionReviewFlags,
} from "./reconstruction-analysis-normalization.js";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=";

function createNode(id: string) {
  return {
    id,
    name: id,
    type: "FRAME",
    fillable: true,
    fills: [],
    fillStyleId: null,
    width: 160,
    height: 100,
    previewDataUrl: PNG_DATA_URL,
  };
}

function createJob(): ReconstructionJob {
  return {
    id: "job-1",
    analysisVersion: "test",
    analysisProvider: "heuristic-local",
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
    applyStatus: "not_applied",
    loopStatus: "idle",
    stopReason: null,
    approvalState: "not-reviewed",
    currentStageId: "analyze-layout",
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    completedAt: null,
    lastAppliedAt: null,
    diffScore: null,
    bestDiffScore: null,
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
    iterationCount: 0,
    appliedNodeIds: [],
    stages: [],
  };
}

test("normalizeReconstructionAnalysisPayload keeps canonical frame aligned with the target frame by default", () => {
  const normalized = normalizeReconstructionAnalysisPayload(
    createJob(),
    {
      designSurfaces: [
        {
          id: "surface-1",
          bounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 },
          fillHex: "#abcdef",
        },
      ],
    },
    160,
    100,
  );

  assert.equal(normalized.canonicalFrame.width, 160);
  assert.equal(normalized.canonicalFrame.height, 100);
  assert.equal(normalized.canonicalFrame.fixedTargetFrame, true);
  assert.equal(normalized.designSurfacesRaw[0]?.fillHex, "#ABCDEF");
});

test("normalizeReconstructionFontMatches deduplicates candidates and filters unknown text ids", () => {
  const matches = normalizeReconstructionFontMatches(
    [
      {
        textCandidateId: "text-1",
        recommended: "Inter",
        candidates: ["Inter", "SF Pro Text", "Inter"],
        confidence: 0.8,
      },
      {
        textCandidateId: "missing",
        recommended: "Avenir Next",
        candidates: [],
        confidence: 0.4,
      },
    ],
    [
      {
        id: "text-1",
        confidence: 0.9,
        bounds: { x: 0, y: 0, width: 0.4, height: 0.1 },
        estimatedRole: "body",
      },
    ],
  );

  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0]?.candidates, ["Inter", "SF Pro Text"]);
});

test("normalizeReconstructionReviewFlags rejects malformed entries", () => {
  const flags = normalizeReconstructionReviewFlags([
    {
      id: "flag-1",
      kind: "font-review",
      severity: "warning",
      message: "review font",
      targetId: "text-1",
    },
    {
      id: "",
      kind: "asset-review",
      severity: "critical",
      message: "bad",
    },
  ]);

  assert.equal(flags.length, 1);
  assert.equal(flags[0]?.id, "flag-1");
});
