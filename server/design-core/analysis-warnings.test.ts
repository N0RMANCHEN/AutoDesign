import assert from "node:assert/strict";
import test from "node:test";

import { buildReconstructionAnalysisWarnings } from "./analysis-warnings.js";

test("buildReconstructionAnalysisWarnings emits hybrid and vector strategy warnings from shared policy", () => {
  const vectorWarnings = buildReconstructionAnalysisWarnings(
    {
      input: { strategy: "vector-reconstruction", allowOutpainting: false },
      targetNode: { width: 120, height: 80 },
    } as any,
    {
      width: 120,
      height: 80,
      textCandidates: [],
      textBlocks: [],
      canonicalFrame: { fixedTargetFrame: false, deprojected: false },
      screenPlane: null,
      semanticNodes: [],
      assetCandidates: [],
      completionZones: [],
    } as any,
  );
  assert.ok(vectorWarnings.some((item) => item.includes("fixedTargetFrame")));
  assert.ok(vectorWarnings.some((item) => item.includes("rectified screen preview")));

  const hybridWarnings = buildReconstructionAnalysisWarnings(
    {
      input: { strategy: "hybrid-reconstruction", allowOutpainting: true },
      targetNode: { width: 120, height: 80 },
    } as any,
    {
      width: 120,
      height: 80,
      textCandidates: [],
      textBlocks: [],
      canonicalFrame: { fixedTargetFrame: true, deprojected: true, sourceQuad: [] },
      screenPlane: null,
      semanticNodes: [],
      assetCandidates: [],
      completionZones: [],
    } as any,
  );
  assert.ok(hybridWarnings.some((item) => item.includes("sourceQuad")));
  assert.ok(hybridWarnings.some((item) => item.includes("completionZones")));
});
