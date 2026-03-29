import assert from "node:assert/strict";
import test from "node:test";

import {
  collectCapabilityIds,
  collectMutatingCapabilityIds,
  hasExplicitCreationParentTarget,
  normalizeLegacyCommandForExternalDispatch,
  prepareBatchForExternalDispatch,
  requiresExplicitNodeIdsForExternalCapability,
} from "./plugin-targeting.js";
import type { FigmaPluginCommandBatch } from "./plugin-contract.js";

test("mutating capabilities require explicit nodeIds while read-only capabilities do not", () => {
  assert.equal(requiresExplicitNodeIdsForExternalCapability("fills.set-fill"), true);
  assert.equal(requiresExplicitNodeIdsForExternalCapability("selection.refresh"), false);
  assert.equal(requiresExplicitNodeIdsForExternalCapability("nodes.inspect-subtree"), false);
  assert.equal(requiresExplicitNodeIdsForExternalCapability("runtime.inspect-font-catalog"), false);
  assert.equal(requiresExplicitNodeIdsForExternalCapability("runtime.probe-font-load"), false);
});

test("hasExplicitCreationParentTarget accepts parent-addressed creation commands", () => {
  assert.equal(
    hasExplicitCreationParentTarget({
      type: "capability",
      capabilityId: "nodes.create-image",
      payload: {
        imageDataUrl: "data:image/png;base64,AAAA",
        width: 120,
        height: 80,
        parentNodeId: "1:2",
      },
    }),
    true,
  );
  assert.equal(
    hasExplicitCreationParentTarget({
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { hex: "#111111", parentNodeId: "1:2" },
    } as any),
    false,
  );
});

test("prepareBatchForExternalDispatch normalizes legacy mutating commands and injects batch nodeIds", () => {
  const batch = prepareBatchForExternalDispatch(
    {
      source: "user",
      commands: [
        {
          type: "set-selection-fill",
          hex: "#222222",
        },
      ],
    },
    ["1:2"],
  );

  assert.equal(batch.source, "codex");
  assert.deepEqual(batch.commands, [
    {
      type: "capability",
      capabilityId: "fills.set-fill",
      payload: { hex: "#222222" },
      nodeIds: ["1:2"],
    },
  ]);
});

test("prepareBatchForExternalDispatch preserves per-command nodeIds over batch nodeIds", () => {
  const batch = prepareBatchForExternalDispatch(
    {
      source: "user",
      commands: [
        {
          type: "capability",
          capabilityId: "fills.set-fill",
          payload: { hex: "#333333" },
          nodeIds: ["9:9"],
        },
      ],
    },
    ["1:2"],
  );

  assert.deepEqual(batch.commands[0], {
    type: "capability",
    capabilityId: "fills.set-fill",
    payload: { hex: "#333333" },
    nodeIds: ["9:9"],
  });
});

test("normalizeLegacyCommandForExternalDispatch keeps existing capability targets when no batch nodeIds are provided", () => {
  const command = normalizeLegacyCommandForExternalDispatch({
    type: "capability",
    capabilityId: "nodes.create-rectangle",
    payload: { width: 80, height: 80, placement: "below", gap: 16 },
    nodeIds: ["4:5"],
  });

  assert.deepEqual(command, {
    type: "capability",
    capabilityId: "nodes.create-rectangle",
    payload: { width: 80, height: 80, placement: "below", gap: 16 },
    nodeIds: ["4:5"],
  });
});

test("collectCapabilityIds and collectMutatingCapabilityIds normalize legacy commands and exclude read-only operations", () => {
  const batch: FigmaPluginCommandBatch = {
    source: "user",
    commands: [
      {
        type: "refresh-selection",
      },
      {
        type: "set-selection-fill",
        hex: "#111111",
      },
      {
        type: "capability",
        capabilityId: "nodes.inspect-subtree",
        payload: { nodeId: "1:2", maxDepth: 2 },
      },
      {
        type: "capability",
        capabilityId: "runtime.inspect-font-catalog",
        payload: {},
      },
      {
        type: "capability",
        capabilityId: "runtime.probe-font-load",
        payload: {
          fonts: [{ family: "Didot", style: "Bold" }],
        },
      },
      {
        type: "capability",
        capabilityId: "fills.set-fill",
        payload: { hex: "#111111" },
      },
    ],
  };

  assert.deepEqual(collectCapabilityIds(batch).sort(), [
    "fills.set-fill",
    "nodes.inspect-subtree",
    "runtime.inspect-font-catalog",
    "runtime.probe-font-load",
    "selection.refresh",
  ]);
  assert.deepEqual(collectMutatingCapabilityIds(batch), ["fills.set-fill"]);
});
