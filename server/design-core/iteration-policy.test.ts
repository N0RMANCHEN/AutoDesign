import assert from "node:assert/strict";
import test from "node:test";

import {
  createDesignCaseRecord,
  evaluateDesignIterationPass,
  formatDesignIterationStopMessage,
  mapDesignStopReasonToReconstructionStopReason,
  resolveDesignIterationStopReason,
  resolveReconstructionIterationStopReason,
} from "./iteration-policy.js";

test("resolveDesignIterationStopReason handles shared automatic stop conditions", () => {
  assert.equal(
    resolveDesignIterationStopReason({
      compositeScore: 0.95,
      hardFailureCount: 0,
      iterationCount: 1,
      maxIterations: 6,
      stagnationCount: 0,
      refineSuggestions: [],
    }),
    "target_reached",
  );

  assert.equal(
    resolveDesignIterationStopReason({
      compositeScore: 0.81,
      hardFailureCount: 0,
      iterationCount: 2,
      maxIterations: 6,
      stagnationCount: 0,
      modeDrift: true,
      refineSuggestions: [],
    }),
    "mode_drift",
  );

  assert.equal(
    resolveReconstructionIterationStopReason({
      compositeScore: 0.81,
      hardFailureCount: 1,
      iterationCount: 2,
      maxIterations: 6,
      stagnationCount: 2,
      refineSuggestions: [
        {
          id: "manual-review",
          kind: "manual-review",
          confidence: 0.99,
          message: "review",
          bounds: null,
        },
      ],
    } as any),
    "stalled",
  );
});

test("evaluateDesignIterationPass rejects non-improving passes and produces reusable case records", () => {
  const pass = evaluateDesignIterationPass({
    mode: "completion",
    regionClusterId: "region-hero",
    changedElementIds: ["node-a"],
    beforeScore: 0.88,
    afterScore: 0.875,
    hardFailures: ["editability-gate"],
    warnings: ["delta below threshold"],
  });

  assert.equal(pass.outcome, "rejected");
  assert.equal(pass.stopReason, "no_improvement");
  assert.equal(pass.scoreDelta, -0.005);
  assert.deepEqual(pass.hardFailures, ["editability-gate"]);

  const caseRecord = createDesignCaseRecord({
    taskId: "design-task/job-1",
    mode: "completion",
    regionPass: pass,
    heuristicId: "test-heuristic",
    createdAt: "2026-03-24T00:00:00.000Z",
    notes: ["case note"],
  });

  assert.equal(caseRecord.regionClusterId, "region-hero");
  assert.equal(caseRecord.outcome, "rejected");
  assert.ok(caseRecord.notes.includes("case note"));
  assert.ok(caseRecord.notes.includes("delta below threshold"));
  assert.equal(mapDesignStopReasonToReconstructionStopReason(pass.stopReason), "stalled");
  assert.match(formatDesignIterationStopMessage(pass.stopReason), /提升低于阈值/);
});
