import assert from "node:assert/strict";
import test from "node:test";

import type { PluginCapabilityId } from "../../../../shared/plugin-capabilities.js";
import type { PluginCommandExecutionResult } from "../../../../shared/plugin-bridge.js";

import { tryRunTextStyleCommand } from "./text-style-command-handlers.js";

function successResult(
  capabilityId: PluginCapabilityId,
  message: string,
  details: Partial<Omit<PluginCommandExecutionResult, "capabilityId" | "ok" | "message">> = {},
): PluginCommandExecutionResult {
  return {
    capabilityId,
    ok: true,
    message,
    changedNodeIds: [],
    createdStyleIds: [],
    createdVariableIds: [],
    exportedImages: [],
    inspectedNodes: [],
    warnings: [],
    errorCode: null,
    ...(details || {}),
  };
}

test("tryRunTextStyleCommand applies a local paint style to target nodes", async () => {
  const node = {
    id: "10:1",
    type: "RECTANGLE",
    fillStyleId: "",
    fills: [],
  };

  (globalThis as any).figma = {
    mixed: Symbol("mixed"),
    getLocalPaintStylesAsync: async () => [{ id: "S:1", name: "Brand/Primary" }],
  };

  const result = await tryRunTextStyleCommand(
    {
      type: "capability",
      capabilityId: "styles.apply-style",
      payload: {
        styleType: "paint",
        styleName: "Brand/Primary",
      },
    } as any,
    "codex",
    {
      getTargetNodes: async () => [node],
      successResult,
    },
  );

  assert.equal(result?.ok, true);
  assert.deepEqual(result?.changedNodeIds, [node.id]);
  assert.equal(node.fillStyleId, "S:1");
});

test("tryRunTextStyleCommand returns null for non-text capabilities", async () => {
  const result = await tryRunTextStyleCommand(
    {
      type: "capability",
      capabilityId: "nodes.rename",
      payload: { name: "Hero" },
    } as any,
    "codex",
    {
      getTargetNodes: async () => [],
      successResult,
    },
  );

  assert.equal(result, null);
});
