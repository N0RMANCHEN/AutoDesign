import type { IncomingMessage, ServerResponse } from "node:http";

import type {
  InspectFrameRequestPayload,
  InspectFrameResponsePayload,
  PluginCommandResultPayload,
  PluginSessionRegistrationPayload,
  QueuePluginCommandPayload,
} from "../../shared/plugin-bridge.js";
import {
  claimNextPluginCommand,
  completePluginCommand,
  getPluginBridgeSnapshot,
  heartbeatPluginSession,
  queuePluginCommand,
  registerPluginSession,
} from "../plugin-bridge-store.js";
import { exportSingleNodeImage, inspectFrameSubtree } from "../plugin-runtime-bridge.js";
import { readBody, sendJson } from "../http-utils.js";
import type { RequestContext } from "./request-context.js";

async function handlePluginBridgeSnapshot(response: ServerResponse) {
  const snapshot = await getPluginBridgeSnapshot();
  sendJson(response, 200, snapshot);
}

async function handlePluginSessionRegister(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const payload = await readBody<PluginSessionRegistrationPayload>(request);
  const session = await registerPluginSession(payload);
  sendJson(response, 200, session);
}

async function handlePluginSessionHeartbeat(
  request: IncomingMessage,
  response: ServerResponse,
  sessionId: string,
) {
  const payload = await readBody<PluginSessionRegistrationPayload>(request);
  const session = await heartbeatPluginSession(sessionId, payload);

  if (!session) {
    sendJson(response, 404, { ok: false, error: "Plugin session not found" });
    return;
  }

  sendJson(response, 200, session);
}

async function handlePluginCommandQueue(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const payload = await readBody<QueuePluginCommandPayload>(request);
  const record = await queuePluginCommand(payload);
  sendJson(response, 200, record);
}

async function handlePluginCommandClaim(
  response: ServerResponse,
  sessionId: string,
) {
  const command = await claimNextPluginCommand(sessionId);
  sendJson(response, 200, { command });
}

async function handlePluginCommandResult(
  request: IncomingMessage,
  response: ServerResponse,
  commandId: string,
) {
  const payload = await readBody<PluginCommandResultPayload>(request);
  const result = await completePluginCommand(commandId, payload);

  if (!result) {
    sendJson(response, 404, { ok: false, error: "Plugin command not found" });
    return;
  }

  sendJson(response, 200, result);
}

async function handleInspectFrame(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const payload = await readBody<InspectFrameRequestPayload>(request);
  if (!payload.targetSessionId || !payload.frameNodeId) {
    sendJson(response, 400, { ok: false, error: "targetSessionId 和 frameNodeId 必填" });
    return;
  }

  try {
    const nodes = await inspectFrameSubtree(payload.targetSessionId, payload.frameNodeId, {
      maxDepth: payload.maxDepth,
    });
    const preview = payload.includePreview === false
      ? null
      : await exportSingleNodeImage(payload.targetSessionId, payload.frameNodeId, {
          constraint: { type: "WIDTH", value: 320 },
        });
    const result: InspectFrameResponsePayload = {
      sessionId: payload.targetSessionId,
      frameNodeId: payload.frameNodeId,
      nodes,
      preview,
    };
    sendJson(response, 200, result);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Frame inspect failed",
    });
  }
}

export async function tryHandlePluginBridgeRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<boolean> {
  const pathSegments = context.pathname.split("/").filter(Boolean);

  if (context.pathname === "/api/plugin-bridge" && context.method === "GET") {
    await handlePluginBridgeSnapshot(response);
    return true;
  }

  if (context.pathname === "/api/plugin-bridge/sessions/register" && context.method === "POST") {
    await handlePluginSessionRegister(request, response);
    return true;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "plugin-bridge" &&
    pathSegments[2] === "sessions" &&
    pathSegments[4] === "heartbeat" &&
    context.method === "POST"
  ) {
    await handlePluginSessionHeartbeat(request, response, pathSegments[3]);
    return true;
  }

  if (context.pathname === "/api/plugin-bridge/commands" && context.method === "POST") {
    await handlePluginCommandQueue(request, response);
    return true;
  }

  if (
    pathSegments.length === 6 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "plugin-bridge" &&
    pathSegments[2] === "sessions" &&
    pathSegments[4] === "commands" &&
    pathSegments[5] === "next" &&
    context.method === "GET"
  ) {
    await handlePluginCommandClaim(response, pathSegments[3]);
    return true;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "plugin-bridge" &&
    pathSegments[2] === "commands" &&
    pathSegments[4] === "result" &&
    context.method === "POST"
  ) {
    await handlePluginCommandResult(request, response, pathSegments[3]);
    return true;
  }

  if (context.pathname === "/api/plugin-bridge/inspect-frame" && context.method === "POST") {
    await handleInspectFrame(request, response);
    return true;
  }

  return false;
}
