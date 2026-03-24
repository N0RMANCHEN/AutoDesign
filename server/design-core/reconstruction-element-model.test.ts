import assert from "node:assert/strict";
import test from "node:test";

import type { ReconstructionAnalysis } from "../../shared/reconstruction.js";
import {
  collectReconstructionElements,
  normalizeReconstructionElements,
} from "./reconstruction-element-model.js";

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
    elements: [],
    elementConstraints: [],
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

test("collectReconstructionElements synthesizes ordered scene elements and sibling constraints", () => {
  const { elements, constraints } = collectReconstructionElements(createAnalysis());

  assert.equal(elements.length, 3);
  assert.equal(elements[0]?.id, "element/surface-top-card");
  assert.ok(constraints.some((constraint) => constraint.kind === "same-parent"));
  assert.ok(constraints.some((constraint) => constraint.kind === "align-top"));
});

test("normalizeReconstructionElements clamps invalid bounds into the normalized frame", () => {
  const elements = normalizeReconstructionElements([
    {
      id: "element-1",
      kind: "surface",
      bounds: { x: -0.2, y: 0.1, width: 1.4, height: 1.2 },
      style: {
        fillHex: "#abcdef",
      },
    },
  ]);

  assert.equal(elements.length, 1);
  assert.deepEqual(elements[0]?.referenceBounds, {
    x: 0,
    y: 0.1,
    width: 1,
    height: 0.9,
  });
  assert.equal(elements[0]?.style.fillHex, "#ABCDEF");
});
