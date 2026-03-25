import type { IncomingMessage, ServerResponse } from "node:http";

import type { QueuePluginCommandPayload } from "../../shared/plugin-bridge.js";
import { buildRuntimeBridgeDispatchReceipt } from "../../shared/runtime-bridge-dispatch.js";
import { readBody, sendJson } from "../http-utils.js";
import { queuePluginCommand } from "../plugin-bridge-store.js";
import type { RequestContext } from "./request-context.js";

async function handleBridgeDispatch(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const payload = await readBody<QueuePluginCommandPayload>(request);
  const record = await queuePluginCommand(payload);
  sendJson(response, 200, buildRuntimeBridgeDispatchReceipt(record));
}

export async function tryHandleRuntimeWriteRoute(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<boolean> {
  if (context.pathname === "/api/runtime/bridge-dispatch" && context.method === "POST") {
    await handleBridgeDispatch(request, response);
    return true;
  }

  return false;
}
