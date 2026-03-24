import assert from "node:assert/strict";
import test from "node:test";

import { buildDesignTaskSnapshotFromReconstructionJob } from "./design-core/reconstruction-compat.js";

function createJob() {
  return {
    id: "job-vector",
    analysisVersion: "test",
    analysisProvider: "codex-assisted",
    input: {
      targetSessionId: "session_1",
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
    currentStageId: "plan-rebuild",
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
    completedAt: null,
    lastAppliedAt: null,
    diffScore: null,
    bestDiffScore: null,
    lastImprovement: null,
    stagnationCount: 0,
    warnings: ["warning a"],
    targetNode: {
      id: "target-1",
      name: "Target Frame",
      type: "FRAME",
      fillable: true,
      fills: [],
      fillStyleId: null,
      width: 160,
      height: 100,
    },
    referenceNode: {
      id: "reference-1",
      name: "Reference Image",
      type: "RECTANGLE",
      fillable: true,
      fills: ["image"],
      fillStyleId: null,
      width: 160,
      height: 100,
      previewDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=",
    },
    referenceRaster: null,
    analysis: {
      width: 160,
      height: 100,
      previewDataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=",
      mimeType: "image/png",
      dominantColors: ["#111111", "#F5F7FF"],
      canonicalFrame: {
        width: 160,
        height: 100,
        fixedTargetFrame: true,
        deprojected: true,
        mappingMode: "reflow",
      },
      screenPlane: {
        extracted: true,
        excludesNonUiShell: true,
        confidence: 0.92,
        sourceQuad: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ],
        rectifiedPreviewDataUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=",
      },
      layoutRegions: [],
      designSurfaces: [
        {
          id: "surface-top-card",
          name: "Top Card",
          bounds: { x: 0.08, y: 0.08, width: 0.72, height: 0.46 },
          fillHex: "#6D6FD0",
          cornerRadius: 24,
          opacity: 1,
          shadow: "soft",
          inferred: false,
        },
      ],
      vectorPrimitives: [],
      semanticNodes: [],
      designTokens: null,
      completionPlan: [],
      textCandidates: [],
      textBlocks: [
        {
          id: "text-score",
          bounds: { x: 0.16, y: 0.18, width: 0.22, height: 0.12 },
          role: "metric",
          content: "37.5%",
          inferred: false,
          fontFamily: "SF Pro Display",
          fontStyle: "Bold",
          fontWeight: 700,
          fontSize: 24,
          lineHeight: 26,
          letterSpacing: 0,
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
        theme: "dark",
        cornerRadiusHint: 24,
        shadowHint: "soft",
        primaryColorHex: "#6D6FD0",
        accentColorHex: "#111111",
      },
      uncertainties: [],
    },
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

test("buildDesignTaskSnapshotFromReconstructionJob maps reconstruction jobs into the generic design-task contract", () => {
  const snapshot = buildDesignTaskSnapshotFromReconstructionJob(createJob() as any);
  assert.equal(snapshot.mode, "restoration");
  assert.equal(snapshot.intent.outputTarget, "figma-native");
  assert.equal(snapshot.intent.automationMode, "automatic-iterative");
  assert.equal(snapshot.scene.rootBounds.width, 160);
  assert.equal(snapshot.scene.elements.length, 2);
  assert.equal(snapshot.scene.elements[0]?.role, "surface");
  assert.equal(snapshot.scene.elements[1]?.role, "text");
  assert.equal(snapshot.scorecard, null);
});
