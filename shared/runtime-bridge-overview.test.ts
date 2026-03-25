import assert from "node:assert/strict";
import test from "node:test";

import { buildRuntimeBridgeOverview } from "./runtime-bridge-overview.js";

test("buildRuntimeBridgeOverview narrows plugin bridge snapshot into a workspace read model", () => {
  const overview = buildRuntimeBridgeOverview({
    sessions: [
      {
        id: "session-1",
        label: "AutoDesign",
        pluginVersion: "0.2.0",
        editorType: "figma",
        fileName: "Demo File",
        pageName: "Page A",
        status: "online",
        lastSeenAt: "2026-03-25T00:00:00.000Z",
        lastHandshakeAt: "2026-03-25T00:00:00.000Z",
        runtimeFeatures: {
          supportsExplicitNodeTargeting: true,
        },
        capabilities: [
          {
            id: "nodes.inspect-subtree",
            domain: "nodes",
            label: "Inspect",
            description: "Inspect subtree",
            supportedEditorTypes: ["figma"],
            requiresSelection: false,
            requiresEditAccess: false,
            requiresPaidFeature: false,
          },
        ],
        selection: [
          {
            id: "node-1",
            name: "Frame",
            type: "FRAME",
            fillable: true,
            fills: [],
            fillStyleId: null,
          },
          {
            id: "node-2",
            name: "Image",
            type: "RECTANGLE",
            fillable: true,
            fills: ["image"],
            fillStyleId: null,
          },
        ],
        hasStyleSnapshot: true,
        styles: [],
        hasVariableSnapshot: false,
        variableCollections: [],
        variables: [],
      },
    ],
    commands: [
      {
        id: "cmd-1",
        targetSessionId: "session-1",
        source: "workspace",
        payload: {
          source: "codex",
          commands: [],
        },
        status: "succeeded",
        createdAt: "2026-03-25T00:00:00.000Z",
        claimedAt: "2026-03-25T00:00:01.000Z",
        completedAt: "2026-03-25T00:00:02.000Z",
        resultMessage: "ok",
        results: [
          {
            capabilityId: "nodes.inspect-subtree",
            ok: true,
            changedNodeIds: ["node-1", "node-1", "node-2"],
            createdStyleIds: [],
            createdVariableIds: [],
            exportedImages: [],
            inspectedNodes: [],
            warnings: ["one", "two"],
            errorCode: null,
            message: "ok",
          },
        ],
      },
    ],
  });

  assert.equal(overview.sessionCount, 1);
  assert.equal(overview.onlineSessionCount, 1);
  assert.equal(overview.commandCounts.succeeded, 1);
  assert.equal(overview.sessions[0]?.selectionCount, 2);
  assert.equal(overview.sessions[0]?.capabilityCount, 1);
  assert.equal(overview.sessions[0]?.supportsExplicitNodeTargeting, true);
  assert.equal(overview.sessions[0]?.hasStyleSnapshot, true);
  assert.equal(overview.sessions[0]?.hasVariableSnapshot, false);
  assert.equal(overview.commands[0]?.warningCount, 2);
  assert.equal(overview.commands[0]?.errorCount, 0);
  assert.equal(overview.commands[0]?.changedNodeCount, 2);
});
