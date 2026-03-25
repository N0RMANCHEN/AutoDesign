import assert from "node:assert/strict";
import test from "node:test";

import type { PluginBridgeSession, PluginNodeInspection } from "./plugin-bridge.js";
import {
  buildRuntimeNodeMetadataFromInspection,
  buildRuntimeNodeMetadataFromSelectionSummary,
  buildUnavailableRuntimeNodeMetadata,
  resolveRuntimeNodeMetadataTarget,
} from "./runtime-node-metadata.js";

function createSession(selection: PluginBridgeSession["selection"]): PluginBridgeSession {
  return {
    id: "session-1",
    label: "AutoDesign",
    pluginVersion: "0.2.0",
    editorType: "figma",
    fileName: "Demo File",
    pageName: "Page 1",
    status: "online",
    lastSeenAt: "2026-03-25T00:00:00.000Z",
    lastHandshakeAt: "2026-03-25T00:00:00.000Z",
    runtimeFeatures: {
      supportsExplicitNodeTargeting: true,
    },
    capabilities: [],
    selection,
  };
}

test("resolveRuntimeNodeMetadataTarget reuses the only selected node when nodeId is omitted", () => {
  const resolved = resolveRuntimeNodeMetadataTarget({
    session: createSession([
      {
        id: "node-1",
        name: "Frame",
        type: "FRAME",
        fillable: true,
        fills: [],
        fillStyleId: null,
      },
    ]),
  });

  assert.equal(resolved.ok, true);
  if (resolved.ok) {
    assert.equal(resolved.nodeId, "node-1");
  }
});

test("buildRuntimeNodeMetadataFromSelectionSummary normalizes a cached selection node into metadata shape", () => {
  const snapshot = buildRuntimeNodeMetadataFromSelectionSummary({
    targetSessionId: "session-1",
    node: {
      id: "node-1",
      name: "Frame",
      type: "FRAME",
      fillable: true,
      fills: [],
      fillStyleId: null,
      styleBindings: {
        fillStyleId: null,
        strokeStyleId: "S:stroke-card",
        textStyleId: null,
        effectStyleId: "S:effect-card",
        gridStyleId: null,
      },
      boundVariableIds: ["var-color-card", "var-gap-card"],
      variableBindings: {
        fills: ["var-color-card"],
        itemSpacing: ["var-gap-card"],
      },
      width: 320,
      height: 200,
      layoutMode: "VERTICAL",
    },
    pluginSession: {
      hasStyleSnapshot: true,
      styles: [
        {
          id: "S:stroke-card",
          styleType: "paint",
          name: "Stroke/Card",
          description: null,
        },
        {
          id: "S:effect-card",
          styleType: "effect",
          name: "Shadow/Card",
          description: "soft card shadow",
        },
      ],
      hasVariableSnapshot: true,
      variables: [
        {
          id: "var-color-card",
          name: "card/background",
          collectionId: "collection-colors",
          collectionName: "Colors",
          resolvedType: "COLOR",
          hiddenFromPublishing: false,
          scopes: ["ALL_FILLS"],
          valuesByMode: [],
        },
      ],
    },
  });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.source, "session-selection-summary");
  assert.equal(snapshot.node?.layoutMode, "VERTICAL");
  assert.equal(snapshot.node?.styleBindings?.strokeStyleId, "S:stroke-card");
  assert.deepEqual(snapshot.node?.boundVariableIds, ["var-color-card", "var-gap-card"]);
  assert.deepEqual(snapshot.node?.variableBindings?.fills, ["var-color-card"]);
  assert.equal(snapshot.resolvedStyleBindings.length, 2);
  assert.equal(snapshot.resolvedStyleBindings[0]?.name, "Stroke/Card");
  assert.equal(snapshot.resolvedStyleBindings[1]?.available, true);
  assert.equal(snapshot.resolvedVariables.length, 1);
  assert.equal(snapshot.resolvedVariables[0]?.id, "var-color-card");
  assert.deepEqual(snapshot.unresolvedVariableIds, ["var-gap-card"]);
  assert.deepEqual(snapshot.subtreeResolvedStyles.map((item) => item.id), [
    "S:stroke-card",
    "S:effect-card",
  ]);
  assert.deepEqual(snapshot.subtreeResolvedVariables.map((item) => item.id), [
    "var-color-card",
  ]);
  assert.deepEqual(snapshot.subtreeUnresolvedStyleIds, []);
  assert.deepEqual(snapshot.subtreeUnresolvedVariableIds, ["var-gap-card"]);
  assert.equal(snapshot.subtree.length, 1);
});

test("buildRuntimeNodeMetadataFromInspection preserves inspected subtree and picks the target node", () => {
  const subtree: PluginNodeInspection[] = [
    {
      id: "node-1",
      name: "Frame",
      type: "FRAME",
      fillable: true,
      fills: [],
      fillStyleId: null,
      styleBindings: {
        fillStyleId: "S:fill-card",
        strokeStyleId: null,
        textStyleId: null,
        effectStyleId: null,
        gridStyleId: null,
      },
      boundVariableIds: ["var-fill-card"],
      variableBindings: {
        fills: ["var-fill-card"],
      },
      depth: 0,
      childCount: 1,
      indexWithinParent: 0,
    },
    {
      id: "node-2",
      name: "Text",
      type: "TEXT",
      fillable: true,
      fills: [],
      fillStyleId: null,
      styleBindings: {
        fillStyleId: null,
        strokeStyleId: null,
        textStyleId: "S:text-title",
        effectStyleId: null,
        gridStyleId: null,
      },
      boundVariableIds: ["var-text-color"],
      variableBindings: {
        fills: ["var-text-color"],
      },
      depth: 1,
      childCount: 0,
      indexWithinParent: 0,
      textContent: "hello",
    },
  ];

  const snapshot = buildRuntimeNodeMetadataFromInspection({
    targetSessionId: "session-1",
    nodeId: "node-1",
    subtree,
    pluginSession: {
      hasStyleSnapshot: true,
      styles: [
        {
          id: "S:fill-card",
          styleType: "paint",
          name: "Fill/Card",
          description: null,
        },
      ],
      hasVariableSnapshot: true,
      variables: [
        {
          id: "var-fill-card",
          name: "card/fill",
          collectionId: "collection-colors",
          collectionName: "Colors",
          resolvedType: "COLOR",
          hiddenFromPublishing: false,
          scopes: ["ALL_FILLS"],
          valuesByMode: [],
        },
      ],
    },
  });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.source, "plugin-inspect-subtree");
  assert.equal(snapshot.node?.id, "node-1");
  assert.equal(snapshot.subtree[1]?.id, "node-2");
  assert.deepEqual(snapshot.resolvedStyleBindings.map((item) => item.styleId), ["S:fill-card"]);
  assert.deepEqual(snapshot.resolvedVariables.map((item) => item.id), ["var-fill-card"]);
  assert.deepEqual(snapshot.unresolvedVariableIds, []);
  assert.deepEqual(snapshot.subtreeResolvedStyles.map((item) => item.id), ["S:fill-card"]);
  assert.deepEqual(snapshot.subtreeResolvedVariables.map((item) => item.id), ["var-fill-card"]);
  assert.deepEqual(snapshot.subtreeUnresolvedStyleIds, ["S:text-title"]);
  assert.deepEqual(snapshot.subtreeUnresolvedVariableIds, ["var-text-color"]);
});

test("buildUnavailableRuntimeNodeMetadata returns a stable unavailable note", () => {
  const snapshot = buildUnavailableRuntimeNodeMetadata({
    targetSessionId: "session-1",
    nodeId: "node-1",
    note: "metadata unavailable",
  });

  assert.equal(snapshot.available, false);
  assert.equal(snapshot.note, "metadata unavailable");
  assert.equal(snapshot.subtree.length, 0);
  assert.deepEqual(snapshot.resolvedStyleBindings, []);
  assert.deepEqual(snapshot.subtreeResolvedStyles, []);
  assert.deepEqual(snapshot.subtreeResolvedVariables, []);
  assert.deepEqual(snapshot.subtreeUnresolvedStyleIds, []);
  assert.deepEqual(snapshot.subtreeUnresolvedVariableIds, []);
});
