import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReconstructionElementScores,
  collectReconstructionElements,
} from "./reconstruction-elements.js";
import type { PluginNodeInspection } from "../shared/plugin-bridge.js";
import type { ReconstructionAnalysis } from "../shared/reconstruction.js";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uoAAAAASUVORK5CYII=";

function createAnalysis(): ReconstructionAnalysis {
  return {
    previewDataUrl: PNG_DATA_URL,
    mimeType: "image/png",
    width: 160,
    height: 100,
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
      confidence: 0.9,
      sourceQuad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      rectifiedPreviewDataUrl: PNG_DATA_URL,
    },
    layoutRegions: [],
    designSurfaces: [
      {
        id: "surface-top-card",
        name: "Top Card",
        bounds: { x: 0.1, y: 0.1, width: 0.7, height: 0.45 },
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
      {
        id: "text-label",
        bounds: { x: 0.5, y: 0.18, width: 0.22, height: 0.05 },
        role: "label",
        content: "TODAY SCORE",
        inferred: false,
        fontFamily: "SF Pro Text",
        fontStyle: "Medium",
        fontWeight: 500,
        fontSize: 11,
        lineHeight: 13,
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
  };
}

function createInspectedNodes(): PluginNodeInspection[] {
  return [
    {
      id: "target-root",
      name: "Target Frame",
      type: "FRAME",
      fillable: true,
      fills: [],
      fillStyleId: null,
      x: 0,
      y: 0,
      absoluteX: 0,
      absoluteY: 0,
      width: 160,
      height: 100,
      depth: 0,
      childCount: 3,
      indexWithinParent: 0,
    },
    {
      id: "node-top-card",
      name: "Top Card",
      type: "FRAME",
      fillable: true,
      fills: ["#6D6FD0"],
      fillStyleId: null,
      x: 16,
      y: 10,
      absoluteX: 16,
      absoluteY: 10,
      width: 112,
      height: 45,
      parentNodeId: "target-root",
      parentNodeType: "FRAME",
      depth: 1,
      childCount: 2,
      indexWithinParent: 0,
      cornerRadius: 24,
      opacity: 1,
      analysisRefId: "surface-top-card",
      generatedBy: "reconstruction",
    },
    {
      id: "node-score",
      name: "37.5%",
      type: "TEXT",
      fillable: true,
      fills: ["#111111"],
      fillStyleId: null,
      x: 25.6,
      y: 18,
      absoluteX: 25.6,
      absoluteY: 18,
      width: 35.2,
      height: 12,
      parentNodeId: "node-top-card",
      parentNodeType: "FRAME",
      depth: 2,
      childCount: 0,
      indexWithinParent: 0,
      textContent: "37.5%",
      fontFamily: "SF Pro Display",
      fontStyle: "Bold",
      fontSize: 24,
      fontWeight: 700,
      textAlignment: "LEFT",
      analysisRefId: "text-score",
      generatedBy: "reconstruction",
    },
    {
      id: "node-label",
      name: "TODAY SCORE",
      type: "TEXT",
      fillable: true,
      fills: ["#111111"],
      fillStyleId: null,
      x: 80,
      y: 18,
      absoluteX: 80,
      absoluteY: 18,
      width: 35.2,
      height: 5,
      parentNodeId: "node-top-card",
      parentNodeType: "FRAME",
      depth: 2,
      childCount: 0,
      indexWithinParent: 1,
      textContent: "TODAY SCORE",
      fontFamily: "SF Pro Text",
      fontStyle: "Medium",
      fontSize: 11,
      fontWeight: 500,
      textAlignment: "LEFT",
      analysisRefId: "text-label",
      generatedBy: "reconstruction",
    },
  ];
}

test("collectReconstructionElements synthesizes elements and constraints from surfaces and text", () => {
  const { elements, constraints } = collectReconstructionElements(createAnalysis());

  assert.equal(elements.length, 3);
  assert.ok(elements.some((element) => element.id === "element/surface-top-card"));
  assert.ok(elements.some((element) => element.id === "element/text-score"));
  assert.ok(constraints.some((constraint) => constraint.kind === "same-parent"));
  assert.ok(constraints.some((constraint) => constraint.kind === "align-top"));
});

test("buildReconstructionElementScores returns high-confidence scores for aligned inspected nodes", async () => {
  const scores = await buildReconstructionElementScores({
    analysis: createAnalysis(),
    inspectedNodes: createInspectedNodes(),
    referencePreviewDataUrl: PNG_DATA_URL,
    renderedPreviewDataUrl: PNG_DATA_URL,
  });

  assert.equal(scores.length, 3);
  const scoreMetric = scores.find((item) => item.elementId === "element/text-score");
  assert.ok(scoreMetric);
  assert.equal(scoreMetric.matchStrategy, "analysis-ref");
  assert.equal(scoreMetric.inspectedNodeId, "node-score");
  assert.ok(scoreMetric.compositeScore >= 0.85);
  assert.equal(scoreMetric.hardFailures.length, 0);
});
