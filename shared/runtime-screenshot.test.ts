import assert from "node:assert/strict";
import test from "node:test";

import type { PluginBridgeSession, PluginImageArtifact } from "./plugin-bridge.js";
import {
  buildRuntimeScreenshotFromArtifact,
  buildRuntimeScreenshotFromSelectionPreview,
  buildUnavailableRuntimeScreenshot,
  resolveRuntimeScreenshotTarget,
} from "./runtime-screenshot.js";

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

test("resolveRuntimeScreenshotTarget uses the only selected node when nodeId is omitted", () => {
  const resolved = resolveRuntimeScreenshotTarget({
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
    assert.equal(resolved.selectionNode?.id, "node-1");
  }
});

test("resolveRuntimeScreenshotTarget rejects ambiguous selection when nodeId is omitted", () => {
  const resolved = resolveRuntimeScreenshotTarget({
    session: createSession([
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
        name: "Card",
        type: "FRAME",
        fillable: true,
        fills: [],
        fillStyleId: null,
      },
    ]),
  });

  assert.equal(resolved.ok, false);
  if (!resolved.ok) {
    assert.match(resolved.error, /多个 selection/);
  }
});

test("buildRuntimeScreenshotFromSelectionPreview keeps cached preview data and node dimensions", () => {
  const snapshot = buildRuntimeScreenshotFromSelectionPreview({
    targetSessionId: "session-1",
    node: {
      id: "node-1",
      name: "Frame",
      type: "FRAME",
      fillable: true,
      fills: [],
      fillStyleId: null,
      width: 160,
      height: 100,
      previewDataUrl: "data:image/png;base64,Zm9v",
    },
  });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.source, "session-selection-preview");
  assert.equal(snapshot.screenshot?.mimeType, "image/png");
  assert.equal(snapshot.screenshot?.width, 160);
});

test("buildRuntimeScreenshotFromArtifact preserves live export source and dimensions", () => {
  const artifact: PluginImageArtifact = {
    kind: "node-image",
    nodeId: "node-1",
    mimeType: "image/png",
    width: 320,
    height: 200,
    dataUrl: "data:image/png;base64,Zm9v",
    source: "node-export",
  };

  const snapshot = buildRuntimeScreenshotFromArtifact({
    targetSessionId: "session-1",
    artifact,
  });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.nodeId, "node-1");
  assert.equal(snapshot.source, "node-export");
  assert.equal(snapshot.screenshot?.height, 200);
});

test("buildUnavailableRuntimeScreenshot returns a stable explicit gap marker", () => {
  const snapshot = buildUnavailableRuntimeScreenshot({
    targetSessionId: "session-1",
    nodeId: "node-1",
    note: "preview missing",
  });

  assert.equal(snapshot.available, false);
  assert.equal(snapshot.source, null);
  assert.equal(snapshot.screenshot, null);
  assert.equal(snapshot.note, "preview missing");
});
