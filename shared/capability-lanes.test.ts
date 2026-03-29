import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPABILITY_LANES,
  getCapabilityLaneDescriptor,
  isCapabilityLaneId,
} from "./capability-lanes.js";

test("capability lanes expose the three product lanes with stable descriptors", () => {
  assert.equal(CAPABILITY_LANES.length, 3);
  assert.equal(getCapabilityLaneDescriptor("code_to_design")?.label, "Code -> Design");
  assert.equal(getCapabilityLaneDescriptor("figma_design")?.defaultSurfaceClass, "formal_support");
  assert.equal(getCapabilityLaneDescriptor("design_to_code")?.output, "frontend_implementation_input");
});

test("isCapabilityLaneId rejects unknown lane ids", () => {
  assert.equal(isCapabilityLaneId("code_to_design"), true);
  assert.equal(isCapabilityLaneId("unknown_lane"), false);
});
