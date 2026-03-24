import assert from "node:assert/strict";
import test from "node:test";

import { buildReconstructionContextPolicy } from "./context-pack-policy.js";

test("buildReconstructionContextPolicy returns shared workflow, scoring rubric and strategy guidance", () => {
  const vectorPolicy = buildReconstructionContextPolicy({
    input: { strategy: "vector-reconstruction" },
  } as any);
  assert.ok(vectorPolicy.workflow.length >= 4);
  assert.ok(vectorPolicy.scoringRubric.some((item) => item.includes("compositeScore")));
  assert.ok(vectorPolicy.guidance.some((item) => item.includes("纯可编辑矢量")));

  const hybridPolicy = buildReconstructionContextPolicy({
    input: { strategy: "hybrid-reconstruction" },
  } as any);
  assert.ok(hybridPolicy.guidance.some((item) => item.includes("raster base")));
});
