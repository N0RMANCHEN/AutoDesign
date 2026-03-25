import type { IncomingMessage, ServerResponse } from "node:http";

import { buildContextPack } from "../../shared/context-pack.js";
import {
  buildRuntimeDesignContext,
  buildRuntimeMetadataSnapshot,
  buildRuntimeVariableDefsContext,
} from "../../shared/runtime-design-context.js";
import { buildRuntimeBridgeOverview } from "../../shared/runtime-bridge-overview.js";
import {
  buildRuntimeScreenshotFromArtifact,
  buildRuntimeScreenshotFromSelectionPreview,
  buildUnavailableRuntimeScreenshot,
  resolveRuntimeScreenshotTarget,
} from "../../shared/runtime-screenshot.js";
import {
  buildRuntimeNodeMetadataFromInspection,
  buildRuntimeNodeMetadataFromSelectionSummary,
  buildUnavailableRuntimeNodeMetadata,
  resolveRuntimeNodeMetadataTarget,
} from "../../shared/runtime-node-metadata.js";
import { runRuntimeAction } from "../../shared/runtime-actions.js";
import type {
  ContextPack,
  GraphKind,
  RuntimeAction,
} from "../../shared/types.js";
import { readBody, sendJson } from "../http-utils.js";
import {
  findSessionById,
  exportSingleNodeImage,
  inspectNodeSubtree,
} from "../plugin-runtime-bridge.js";
import { getPluginBridgeSnapshot } from "../plugin-bridge-store.js";
import { readProject } from "../storage.js";
import type { RequestContext } from "./request-context.js";

async function handleContextPack(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readBody<{
    selectionIds?: string[];
    graphKind?: GraphKind;
    action?: RuntimeAction;
  }>(request);
  const project = await readProject();
  const contextPack = buildContextPack({
    project,
    selectionIds: body.selectionIds ?? [],
    graphKind: body.graphKind ?? "codegraph",
    action: body.action ?? "codegraph/summarize",
  });
  sendJson(response, 200, contextPack);
}

async function handleMetadata(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readBody<{
    selectionIds?: string[];
  }>(request);
  const project = await readProject();
  const metadata = buildRuntimeMetadataSnapshot({
    project,
    selectionIds: body.selectionIds ?? [],
  });
  sendJson(response, 200, metadata);
}

async function handleBridgeOverview(response: ServerResponse) {
  const snapshot = await getPluginBridgeSnapshot();
  sendJson(response, 200, buildRuntimeBridgeOverview(snapshot));
}

async function handleNodeMetadata(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readBody<{
    targetSessionId?: string;
    nodeId?: string;
    allowLiveInspect?: boolean;
    maxDepth?: number;
  }>(request);

  if (!String(body.targetSessionId || "").trim()) {
    sendJson(response, 400, { ok: false, error: "targetSessionId is required" });
    return;
  }

  const targetSessionId = String(body.targetSessionId).trim();
  const snapshot = await getPluginBridgeSnapshot();
  const session = findSessionById(snapshot.sessions, targetSessionId);
  if (!session) {
    sendJson(response, 404, { ok: false, error: "Plugin session not found" });
    return;
  }

  const resolved = resolveRuntimeNodeMetadataTarget({
    session,
    nodeId: body.nodeId,
  });
  if (!resolved.ok) {
    sendJson(response, 400, { ok: false, error: resolved.error });
    return;
  }

  if (resolved.selectionNode && body.allowLiveInspect !== true) {
    sendJson(
      response,
      200,
      buildRuntimeNodeMetadataFromSelectionSummary({
        targetSessionId,
        node: resolved.selectionNode,
        pluginSession: session,
      }),
    );
    return;
  }

  if (body.allowLiveInspect !== true) {
    sendJson(
      response,
      200,
      buildUnavailableRuntimeNodeMetadata({
        targetSessionId,
        nodeId: resolved.nodeId,
        note: "当前节点不在缓存 selection 摘要里；如需 live metadata，请传 allowLiveInspect=true。",
      }),
    );
    return;
  }

  try {
    const subtree = await inspectNodeSubtree(targetSessionId, resolved.nodeId, {
      maxDepth: body.maxDepth,
    });
    sendJson(
      response,
      200,
      buildRuntimeNodeMetadataFromInspection({
        targetSessionId,
        nodeId: resolved.nodeId,
        subtree,
        pluginSession: session,
      }),
    );
  } catch (error) {
    sendJson(
      response,
      200,
      buildUnavailableRuntimeNodeMetadata({
        targetSessionId,
        nodeId: resolved.nodeId,
        note: `live metadata failed: ${error instanceof Error ? error.message : "unknown error"}`,
      }),
    );
  }
}

async function handleVariableDefs(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readBody<{
    selectionIds?: string[];
    targetSessionId?: string;
  }>(request);
  const project = await readProject();
  const snapshot = body.targetSessionId ? await getPluginBridgeSnapshot() : null;
  const pluginSession = body.targetSessionId
    ? findSessionById(snapshot?.sessions ?? [], String(body.targetSessionId).trim())
    : null;
  if (body.targetSessionId && !pluginSession) {
    sendJson(response, 404, { ok: false, error: "Plugin session not found" });
    return;
  }
  const variableDefs = buildRuntimeVariableDefsContext({
    project,
    selectionIds: body.selectionIds ?? [],
    pluginSession,
  });
  sendJson(response, 200, variableDefs);
}

async function handleDesignContext(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readBody<{
    selectionIds?: string[];
    graphKind?: GraphKind;
    action?: RuntimeAction;
    targetSessionId?: string;
  }>(request);
  const project = await readProject();
  const snapshot = body.targetSessionId ? await getPluginBridgeSnapshot() : null;
  const pluginSession = body.targetSessionId
    ? findSessionById(snapshot?.sessions ?? [], String(body.targetSessionId).trim())
    : null;
  if (body.targetSessionId && !pluginSession) {
    sendJson(response, 404, { ok: false, error: "Plugin session not found" });
    return;
  }
  const designContext = buildRuntimeDesignContext({
    project,
    selectionIds: body.selectionIds ?? [],
    graphKind: body.graphKind ?? "codegraph",
    action: body.action ?? "codegraph/summarize",
    pluginSession,
  });
  sendJson(response, 200, designContext);
}

async function handleScreenshot(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readBody<{
    targetSessionId?: string;
    nodeId?: string;
    allowLiveExport?: boolean;
    preferOriginalBytes?: boolean;
    constraint?: { type: "WIDTH" | "HEIGHT" | "SCALE"; value: number };
  }>(request);

  if (!String(body.targetSessionId || "").trim()) {
    sendJson(response, 400, { ok: false, error: "targetSessionId is required" });
    return;
  }

  const targetSessionId = String(body.targetSessionId).trim();
  const snapshot = await getPluginBridgeSnapshot();
  const session = findSessionById(snapshot.sessions, targetSessionId);
  if (!session) {
    sendJson(response, 404, { ok: false, error: "Plugin session not found" });
    return;
  }

  const resolved = resolveRuntimeScreenshotTarget({
    session,
    nodeId: body.nodeId,
  });
  if (!resolved.ok) {
    sendJson(response, 400, { ok: false, error: resolved.error });
    return;
  }

  if (resolved.selectionNode?.previewDataUrl) {
    sendJson(
      response,
      200,
      buildRuntimeScreenshotFromSelectionPreview({
        targetSessionId,
        node: resolved.selectionNode,
      }),
    );
    return;
  }

  if (body.allowLiveExport !== true) {
    sendJson(
      response,
      200,
      buildUnavailableRuntimeScreenshot({
        targetSessionId,
        nodeId: resolved.nodeId,
        note: "当前节点没有缓存 previewDataUrl；如需 live screenshot，请传 allowLiveExport=true。",
      }),
    );
    return;
  }

  try {
    const artifact = await exportSingleNodeImage(targetSessionId, resolved.nodeId, {
      preferOriginalBytes: body.preferOriginalBytes,
      constraint: body.constraint,
    });
    sendJson(
      response,
      200,
      buildRuntimeScreenshotFromArtifact({
        targetSessionId,
        artifact,
      }),
    );
  } catch (error) {
    sendJson(
      response,
      200,
      buildUnavailableRuntimeScreenshot({
        targetSessionId,
        nodeId: resolved.nodeId,
        note: `live screenshot failed: ${error instanceof Error ? error.message : "unknown error"}`,
      }),
    );
  }
}

async function handleRuntimeRun(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const contextPack = await readBody<ContextPack>(request);
  const result = runRuntimeAction(contextPack);
  sendJson(response, 200, result);
}

export async function tryHandleRuntimeReadRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<boolean> {
  if (context.pathname === "/api/runtime/bridge-overview" && context.method === "GET") {
    await handleBridgeOverview(response);
    return true;
  }

  if (context.pathname === "/api/runtime/context-pack" && context.method === "POST") {
    await handleContextPack(request, response);
    return true;
  }

  if (context.pathname === "/api/runtime/metadata" && context.method === "POST") {
    await handleMetadata(request, response);
    return true;
  }

  if (context.pathname === "/api/runtime/node-metadata" && context.method === "POST") {
    await handleNodeMetadata(request, response);
    return true;
  }

  if (context.pathname === "/api/runtime/variable-defs" && context.method === "POST") {
    await handleVariableDefs(request, response);
    return true;
  }

  if (context.pathname === "/api/runtime/design-context" && context.method === "POST") {
    await handleDesignContext(request, response);
    return true;
  }

  if (context.pathname === "/api/runtime/screenshot" && context.method === "POST") {
    await handleScreenshot(request, response);
    return true;
  }

  if (context.pathname === "/api/runtime/run" && context.method === "POST") {
    await handleRuntimeRun(request, response);
    return true;
  }

  return false;
}
