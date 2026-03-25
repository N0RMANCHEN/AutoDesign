import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeBridgeDispatchReceipt } from "./runtime-bridge-dispatch.js";

test("buildRuntimeBridgeDispatchReceipt narrows queued command records into a workspace write receipt", () => {
  const receipt = buildRuntimeBridgeDispatchReceipt({
    id: "cmd-1",
    targetSessionId: "session-1",
    source: "workspace",
    payload: {
      source: "codex",
      commands: [
        {
          type: "set-selection-fill",
          hex: "#FF6FAE",
        },
        {
          type: "set-selection-stroke",
          hex: "#2563EB",
        },
      ],
    },
    status: "queued",
    createdAt: "2026-03-25T00:00:00.000Z",
    claimedAt: null,
    completedAt: null,
    resultMessage: "",
    results: [],
  });

  assert.equal(receipt.command.id, "cmd-1");
  assert.equal(receipt.command.targetSessionId, "session-1");
  assert.equal(receipt.command.status, "queued");
  assert.equal(receipt.command.warningCount, 0);
  assert.equal(receipt.command.errorCount, 0);
  assert.equal(receipt.command.changedNodeCount, 0);
  assert.equal(receipt.payloadCommandCount, 2);
});
