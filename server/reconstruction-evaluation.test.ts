import assert from "node:assert/strict";
import test from "node:test";

import { buildRefineSuggestions, createRenderedPreview } from "./reconstruction-evaluation.js";
import type {
  ReconstructionAcceptanceGate,
  ReconstructionDiffMetrics,
  ReconstructionDiffHotspot,
  ReconstructionJob,
} from "../shared/reconstruction.js";

function createNodeSummary(id: string) {
  return {
    id,
    name: id,
    type: "FRAME",
    fillable: true,
    fills: [],
    fillStyleId: null,
    width: 100,
    height: 100,
  };
}

function createHotspot(bounds?: Partial<ReconstructionDiffHotspot["bounds"]>): ReconstructionDiffHotspot {
  return {
    id: "hotspot-1",
    score: 0.72,
    bounds: {
      x: bounds?.x ?? 10,
      y: bounds?.y ?? 10,
      width: bounds?.width ?? 120,
      height: bounds?.height ?? 80,
    },
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
    actual: passed ? 0.92 : 0.45,
    passed,
    hard: true,
    ...overrides,
  };
}

function createDiffMetrics(overrides?: Partial<ReconstructionDiffMetrics>): ReconstructionDiffMetrics {
  return {
    globalSimilarity: 0.88,
    colorDelta: 0.2,
    edgeSimilarity: 0.86,
    layoutSimilarity: 0.84,
    structureSimilarity: 0.82,
    hotspotAverage: 0.48,
    hotspotPeak: 0.66,
    hotspotCoverage: 0.51,
    compositeScore: 0.78,
    grade: "C",
    acceptanceGates: [],
    hotspots: [],
    ...overrides,
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
      maxIterations: 3,
      allowOutpainting: false,
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
    warnings: [],
    targetNode: createNodeSummary("target-1"),
    referenceNode: createNodeSummary("reference-1"),
    referenceRaster: null,
    analysis: {
      layoutRegions: [
        {
          id: "hero",
          kind: "surface",
          confidence: 0.91,
          bounds: { x: 0, y: 0, width: 240, height: 180 },
          fillHex: "#FFFFFF",
        },
      ],
    } as NonNullable<ReconstructionJob["analysis"]>,
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

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=";

test("createRenderedPreview keeps mime type and target dimensions", () => {
  const preview = createRenderedPreview(PNG_DATA_URL, 1440, 900);

  assert.equal(preview.previewDataUrl, PNG_DATA_URL);
  assert.equal(preview.mimeType, "image/png");
  assert.equal(preview.width, 1440);
  assert.equal(preview.height, 900);
  assert.match(preview.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("buildRefineSuggestions emits fill and layout nudges for failing color and layout gates", () => {
  const job = createJob();
  const hotspot = createHotspot();
  const diffMetrics = createDiffMetrics({
    colorDelta: 0.41,
    layoutSimilarity: 0.51,
    structureSimilarity: 0.57,
    acceptanceGates: [
      createGate("colorDelta", false, { comparator: "lte", threshold: 0.15, actual: 0.41 }),
      createGate("layoutSimilarity", false),
      createGate("structureSimilarity", false),
    ],
    hotspots: [hotspot],
  });

  const suggestions = buildRefineSuggestions(job, diffMetrics);

  assert.equal(suggestions[0]?.kind, "nudge-fill");
  assert.deepEqual(suggestions[0]?.bounds, hotspot.bounds);
  assert.equal(suggestions[1]?.kind, "nudge-layout");
  assert.match(suggestions[1]?.message ?? "", /hero/);
});

test("buildRefineSuggestions emits text nudges on edge failures", () => {
  const job = createJob();
  const hotspot = createHotspot({ x: 30, y: 18, width: 90, height: 40 });
  const diffMetrics = createDiffMetrics({
    edgeSimilarity: 0.43,
    acceptanceGates: [
      createGate("edgeSimilarity", false),
      createGate("globalSimilarity", false),
    ],
    hotspots: [hotspot],
  });

  const suggestions = buildRefineSuggestions(job, diffMetrics);
  const textSuggestion = suggestions.find((item) => item.kind === "nudge-text");

  assert.ok(textSuggestion);
  assert.deepEqual(textSuggestion.bounds, hotspot.bounds);
  assert.match(textSuggestion.message, /字号|文案|线条/);
});

test("buildRefineSuggestions falls back to manual review when hard gates pass and score is strong", () => {
  const job = createJob();
  const diffMetrics = createDiffMetrics({
    compositeScore: 0.93,
    grade: "A",
    acceptanceGates: [
      createGate("layoutSimilarity", true),
      createGate("colorDelta", true, { comparator: "lte", threshold: 0.15, actual: 0.08 }),
    ],
    hotspots: [createHotspot()],
  });

  const suggestions = buildRefineSuggestions(job, diffMetrics);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0]?.kind, "manual-review");
  assert.equal(suggestions[0]?.confidence, 0.92);
  assert.match(suggestions[0]?.message ?? "", /通过硬门槛/);
});
