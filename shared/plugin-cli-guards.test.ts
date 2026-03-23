import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureExplicitTargetingForMutations,
  ensureSafeMutationBatch,
  parseNodeIds,
  parseReconstructionStrategy,
} from "./plugin-cli-guards.js";
import type { PluginBridgeSession } from "./plugin-bridge.js";
import type { FigmaPluginCommandBatch } from "./plugin-contract.js";

function readFlag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function createSession(overrides?: Partial<PluginBridgeSession>): PluginBridgeSession {
  return {
    id: "session-1",
    label: "AutoDesign",
    pluginVersion: "0.2.0",
    editorType: "figma",
    fileName: "Demo File",
    pageName: "Page 1",
    status: "online",
    lastSeenAt: "2026-03-23T00:00:00.000Z",
    lastHandshakeAt: "2026-03-23T00:00:00.000Z",
    runtimeFeatures: {
      supportsExplicitNodeTargeting: true,
    },
    capabilities: [],
    selection: [
      {
        id: "1:2",
        name: "Hero Card",
        type: "FRAME",
        fillable: true,
        fills: [],
        fillStyleId: null,
      },
    ],
    ...overrides,
  };
}

test("parseNodeIds trims and filters empty entries", () => {
  assert.deepEqual(parseNodeIds(" 1:2, , 3:4 ,,5:6 "), ["1:2", "3:4", "5:6"]);
  assert.deepEqual(parseNodeIds(null), []);
});

test("parseReconstructionStrategy resolves explicit and alias flags", () => {
  assert.equal(
    parseReconstructionStrategy(["node", "cli", "reconstruct", "--strategy", "hybrid-reconstruction"], readFlag),
    "hybrid-reconstruction",
  );
  assert.equal(
    parseReconstructionStrategy(["node", "cli", "reconstruct", "--raster-exact"], readFlag),
    "raster-exact",
  );
  assert.equal(
    parseReconstructionStrategy(["node", "cli", "reconstruct", "--vector-reconstruction"], readFlag),
    "vector-reconstruction",
  );
  assert.equal(
    parseReconstructionStrategy(["node", "cli", "reconstruct", "--structural-preview"], readFlag),
    "structural-preview",
  );
  assert.equal(
    parseReconstructionStrategy(["node", "cli", "reconstruct"], readFlag),
    undefined,
  );
});

test("parseReconstructionStrategy rejects unsupported explicit strategies", () => {
  assert.throws(
    () =>
      parseReconstructionStrategy(
        ["node", "cli", "reconstruct", "--strategy", "invalid-mode"],
        readFlag,
      ),
    /不支持的 reconstruction strategy: invalid-mode/,
  );
});

test("ensureExplicitTargetingForMutations rejects mutating batches when runtime lacks explicit targeting", () => {
  const batch: FigmaPluginCommandBatch = {
    source: "codex",
    commands: [
      {
        type: "capability",
        capabilityId: "fills.set-fill",
        payload: { hex: "#111111" },
      },
    ],
  };

  assert.throws(
    () =>
      ensureExplicitTargetingForMutations(
        batch,
        createSession({
          runtimeFeatures: { supportsExplicitNodeTargeting: false },
        }),
        ["1:2"],
      ),
    /不支持显式 nodeIds 定向/,
  );
});

test("ensureExplicitTargetingForMutations rejects mutating batches without explicit nodeIds", () => {
  const batch: FigmaPluginCommandBatch = {
    source: "codex",
    commands: [
      {
        type: "capability",
        capabilityId: "fills.set-fill",
        payload: { hex: "#111111" },
      },
    ],
  };

  assert.throws(
    () => ensureExplicitTargetingForMutations(batch, createSession(), []),
    /修改类外部命令必须提供 --node-ids/,
  );
});

test("ensureExplicitTargetingForMutations allows read-only batches and per-command targets", () => {
  const readOnlyBatch: FigmaPluginCommandBatch = {
    source: "codex",
    commands: [
      {
        type: "capability",
        capabilityId: "selection.refresh",
        payload: {},
      },
    ],
  };
  const targetedBatch: FigmaPluginCommandBatch = {
    source: "codex",
    commands: [
      {
        type: "capability",
        capabilityId: "fills.set-fill",
        payload: { hex: "#111111" },
        nodeIds: ["1:2"],
      },
    ],
  };

  assert.doesNotThrow(() => ensureExplicitTargetingForMutations(readOnlyBatch, createSession(), []));
  assert.doesNotThrow(() => ensureExplicitTargetingForMutations(targetedBatch, createSession(), []));
});

test("ensureSafeMutationBatch rejects mixed mutating target sets in the same batch", () => {
  const batch: FigmaPluginCommandBatch = {
    source: "codex",
    commands: [
      {
        type: "capability",
        capabilityId: "fills.set-fill",
        payload: { hex: "#111111" },
        nodeIds: ["1:2"],
      },
      {
        type: "capability",
        capabilityId: "nodes.rename",
        payload: { name: "Renamed" },
        nodeIds: ["3:4"],
      },
    ],
  };

  assert.throws(
    () => ensureSafeMutationBatch(batch),
    /不能在同一批次里混用多组 nodeIds/,
  );
});

test("ensureSafeMutationBatch allows a shared mutating target set", () => {
  const batch: FigmaPluginCommandBatch = {
    source: "codex",
    commands: [
      {
        type: "capability",
        capabilityId: "fills.set-fill",
        payload: { hex: "#111111" },
        nodeIds: ["1:2"],
      },
      {
        type: "capability",
        capabilityId: "nodes.rename",
        payload: { name: "Renamed" },
        nodeIds: ["1:2"],
      },
    ],
  };

  assert.doesNotThrow(() => ensureSafeMutationBatch(batch));
});
