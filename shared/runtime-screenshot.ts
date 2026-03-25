import type {
  PluginBridgeSession,
  PluginImageArtifact,
  PluginNodeSummary,
} from "./plugin-bridge.js";
import {
  resolveRuntimePluginTarget,
  type RuntimePluginTargetResolution,
} from "./runtime-plugin-target.js";

export type RuntimeScreenshotSnapshot = {
  targetSessionId: string;
  nodeId: string | null;
  available: boolean;
  source: "session-selection-preview" | PluginImageArtifact["source"] | null;
  note: string | null;
  screenshot: {
    mimeType: string;
    width: number | null;
    height: number | null;
    dataUrl: string;
  } | null;
};

export type RuntimeScreenshotResolution = RuntimePluginTargetResolution;

function readMimeTypeFromDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(String(dataUrl || ""));
  return match?.[1] ?? null;
}

export function resolveRuntimeScreenshotTarget(params: {
  session: PluginBridgeSession;
  nodeId?: string | null;
}): RuntimeScreenshotResolution {
  return resolveRuntimePluginTarget(params);
}

export function buildRuntimeScreenshotFromSelectionPreview(params: {
  targetSessionId: string;
  node: PluginNodeSummary;
}): RuntimeScreenshotSnapshot {
  const mimeType = readMimeTypeFromDataUrl(params.node.previewDataUrl ?? "");
  if (!params.node.previewDataUrl || !mimeType) {
    return buildUnavailableRuntimeScreenshot({
      targetSessionId: params.targetSessionId,
      nodeId: params.node.id,
      note: "当前 selection 节点没有可用的 previewDataUrl。",
    });
  }

  return {
    targetSessionId: params.targetSessionId,
    nodeId: params.node.id,
    available: true,
    source: "session-selection-preview",
    note: null,
    screenshot: {
      mimeType,
      width: typeof params.node.width === "number" ? params.node.width : null,
      height: typeof params.node.height === "number" ? params.node.height : null,
      dataUrl: params.node.previewDataUrl,
    },
  };
}

export function buildRuntimeScreenshotFromArtifact(params: {
  targetSessionId: string;
  artifact: PluginImageArtifact;
}): RuntimeScreenshotSnapshot {
  return {
    targetSessionId: params.targetSessionId,
    nodeId: params.artifact.nodeId,
    available: true,
    source: params.artifact.source,
    note: null,
    screenshot: {
      mimeType: params.artifact.mimeType,
      width: params.artifact.width,
      height: params.artifact.height,
      dataUrl: params.artifact.dataUrl,
    },
  };
}

export function buildUnavailableRuntimeScreenshot(params: {
  targetSessionId: string;
  nodeId: string | null;
  note: string;
}): RuntimeScreenshotSnapshot {
  return {
    targetSessionId: params.targetSessionId,
    nodeId: params.nodeId,
    available: false,
    source: null,
    note: params.note,
    screenshot: null,
  };
}
