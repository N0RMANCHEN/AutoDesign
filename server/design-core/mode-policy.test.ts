import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDesignIntentFromReconstructionJob,
  buildDesignModePolicy,
  inferDesignTaskModeFromReconstructionJob,
} from "./mode-policy.js";

test("inferDesignTaskModeFromReconstructionJob covers restoration, completion and generation", () => {
  assert.equal(
    inferDesignTaskModeFromReconstructionJob({
      input: {
        strategy: "vector-reconstruction",
        allowOutpainting: false,
      },
      analysis: null,
    } as any),
    "restoration",
  );

  assert.equal(
    inferDesignTaskModeFromReconstructionJob({
      input: {
        strategy: "hybrid-reconstruction",
        allowOutpainting: true,
      },
      analysis: null,
    } as any),
    "completion",
  );

  assert.equal(
    inferDesignTaskModeFromReconstructionJob({
      input: {
        strategy: "structural-preview",
        allowOutpainting: false,
      },
      analysis: null,
    } as any),
    "generation",
  );
});

test("buildDesignModePolicy and intent keep generation aligned with editable figma-native output", () => {
  const policy = buildDesignModePolicy("generation");
  assert.equal(policy.outputTarget, "figma-native");
  assert.equal(policy.qualityPriority, "design-quality");
  assert.equal(policy.referencePolicy, "preferred");
  assert.equal(policy.editabilityRequired, true);

  const intent = buildDesignIntentFromReconstructionJob({
    input: {
      strategy: "structural-preview",
      allowOutpainting: false,
    },
    analysis: null,
    warnings: ["keep text editable"],
  } as any);
  assert.equal(intent.mode, "generation");
  assert.ok(intent.notes.includes("keep text editable"));
});
