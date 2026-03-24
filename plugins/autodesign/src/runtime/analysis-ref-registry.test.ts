import assert from "node:assert/strict";
import test from "node:test";

import {
  createBatchExecutionContext,
  normalizeAnalysisRefId,
  registerAnalysisRefId,
  resolveBatchNodeId,
} from "./analysis-ref-registry.js";

test("analysis ref registry normalizes and resolves analysis-prefixed ids", () => {
  const context = createBatchExecutionContext();
  registerAnalysisRefId(context, "analysis:header-title", "42:7");

  assert.equal(normalizeAnalysisRefId("analysis:hero"), "hero");
  assert.equal(resolveBatchNodeId(context, "analysis:header-title"), "42:7");
  assert.equal(resolveBatchNodeId(context, "plain-node-id"), "plain-node-id");
});

test("analysis ref registry rejects unresolved analysis refs", () => {
  const context = createBatchExecutionContext();

  assert.throws(() => resolveBatchNodeId(context, "analysis:missing"), /未在当前 batch 中注册/);
});
