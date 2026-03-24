import assert from "node:assert/strict";
import test from "node:test";

import type { PluginCapabilityId } from "../../../../shared/plugin-capabilities.js";
import type { PluginCommandExecutionResult } from "../../../../shared/plugin-bridge.js";

import { tryRunNodeCommand } from "./node-command-handlers.js";

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

test("tryRunNodeCommand deletes explicit nodeIds without selection lookup", async () => {
  const removed: string[] = [];
  const childNode = {
    id: "12:1",
    name: "Layer",
    parent: { id: "0:1" },
    remove() {
      removed.push(this.id);
    },
  };
  const rootNode = {
    id: "0:1",
    name: "Page Root",
    parent: null,
    remove() {
      removed.push(this.id);
    },
  };

  (globalThis as any).figma = {
    getNodeByIdAsync: async (nodeId: string) => {
      if (nodeId === childNode.id) return childNode;
      if (nodeId === rootNode.id) return rootNode;
      return null;
    },
  };

  const result = await tryRunNodeCommand(
    {
      type: "capability",
      capabilityId: "nodes.delete",
      nodeIds: [childNode.id, rootNode.id, "missing"],
      payload: {},
    } as any,
    "codex",
    {
      getTargetNodes: async () => {
        throw new Error("should not read selection");
      },
      successResult,
    },
  );

  assert.equal(result?.ok, true);
  assert.deepEqual(result?.changedNodeIds, [childNode.id]);
  assert.deepEqual(removed, [childNode.id]);
  assert.match((result?.warnings || []).join("\n"), /无法删除/);
  assert.match((result?.warnings || []).join("\n"), /未找到/);
});

test("tryRunNodeCommand returns null for non-node capabilities", async () => {
  const result = await tryRunNodeCommand(
    {
      type: "capability",
      capabilityId: "text.set-content",
      payload: { value: "hello" },
    } as any,
    "codex",
    {
      getTargetNodes: async () => [],
      successResult,
    },
  );

  assert.equal(result, null);
});
