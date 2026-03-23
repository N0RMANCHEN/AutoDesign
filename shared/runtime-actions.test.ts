import assert from "node:assert/strict";
import test from "node:test";

import { runRuntimeAction } from "./runtime-actions.js";
import type { ContextPack } from "./types.js";

function asRecord(value: unknown) {
  return value as Record<string, any>;
}

function createContextPack(action: ContextPack["action"]): ContextPack {
  return {
    graphKind: action.startsWith("knowledge/") ? "knowledge" : "codegraph",
    action,
    primaryId: "node-1",
    selectionIds: ["node-1", "node-2"],
    nodes: [
      {
        id: "node-1",
        kind: "screen",
        title: "Hero Screen",
        summary: "Main hero summary",
        position: { x: 120, y: 200 },
      },
      {
        id: "node-2",
        kind: "component",
        title: "HeroCard -> HeroCard",
        summary: "Component summary",
        position: { x: 420, y: 360 },
      },
    ],
    constraints: {
      maxNewNodes: 4,
      allowDelete: false,
      allowEdges: true,
    },
  };
}

test("runRuntimeAction asks for selection when the context pack is empty", () => {
  const result = runRuntimeAction({
    graphKind: "codegraph",
    action: "codegraph/summarize",
    primaryId: null,
    selectionIds: [],
    nodes: [],
    constraints: {
      maxNewNodes: 4,
      allowDelete: false,
      allowEdges: true,
    },
  });

  assert.deepEqual(result.patch.ops, []);
  assert.deepEqual(result.questions, ["请至少选择一个设计源、页面、组件映射或评审项。"]);
  assert.match(result.explanation, /缺少选中对象/);
});

test("runRuntimeAction generates three deterministic branch suggestions for codegraph/branch", () => {
  const result = runRuntimeAction(createContextPack("codegraph/branch"));
  const nodeOps = result.patch.ops
    .filter((item) => asRecord(item).op === "upsertNode")
    .map((item) => asRecord(item));
  const edgeOps = result.patch.ops
    .filter((item) => asRecord(item).op === "upsertEdge")
    .map((item) => asRecord(item));

  assert.equal(result.questions.length, 0);
  assert.equal(result.patch.ops.length, 6);
  assert.equal(nodeOps.length, 3);
  assert.equal(edgeOps.length, 3);
  assert.deepEqual(
    nodeOps.map((item) => item.node.title),
    ["Next Step 1", "Next Step 2", "Next Step 3"],
  );
});

test("runRuntimeAction reflows selected nodes into a frame for reorganize_to_frame", () => {
  const result = runRuntimeAction(createContextPack("codegraph/reorganize_to_frame"));
  const firstOp = asRecord(result.patch.ops[0]);

  assert.equal(firstOp.op, "upsertNode");
  assert.equal(firstOp.node.kind, "frame");
  assert.deepEqual(result.patch.ops.slice(1).map((item) => asRecord(item).op), ["moveNode", "moveNode"]);
  assert.equal(firstOp.node.position.x, 40);
  assert.equal(firstOp.node.position.y, 120);
});

test("runRuntimeAction creates a four-step learning path for knowledge/learning_path", () => {
  const result = runRuntimeAction(createContextPack("knowledge/learning_path"));
  const stepOps = result.patch.ops.map((item) => asRecord(item));

  assert.equal(result.patch.ops.length, 4);
  assert.deepEqual(
    stepOps.map((item) => item.op),
    ["appendStep", "appendStep", "appendStep", "appendStep"],
  );
  assert.deepEqual(
    stepOps.map((item) => item.step.order),
    [1, 2, 3, 4],
  );
});
