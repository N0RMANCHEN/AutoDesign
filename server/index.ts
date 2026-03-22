import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildContextPack } from "../shared/context-pack.js";
import type {
  PluginCommandResultPayload,
  PluginSessionRegistrationPayload,
  QueuePluginCommandPayload,
} from "../shared/plugin-bridge.js";
import { runRuntimeAction } from "../shared/runtime-actions.js";
import type {
  ContextPack,
  FigmaSyncPayload,
  GraphKind,
  ProjectData,
  RuntimeAction,
} from "../shared/types.js";
import { nowIso, slugify } from "../shared/utils.js";
import {
  claimNextPluginCommand,
  completePluginCommand,
  getPluginBridgeSnapshot,
  heartbeatPluginSession,
  queuePluginCommand,
  registerPluginSession,
} from "./plugin-bridge-store.js";
import { readProject, resetProject, writeProject } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.resolve(__dirname, "..");
const distDirectory = path.join(rootDirectory, "dist");
const port = Number(process.env.PORT ?? 3001);

type RequestContext = {
  pathname: string;
  method: string;
};

function sendJson(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(body));
}

function sendText(response: import("node:http").ServerResponse, status: number, body: string) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(body);
}

async function readBody<T>(request: import("node:http").IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return (raw ? JSON.parse(raw) : {}) as T;
}

async function handleProjectGet(response: import("node:http").ServerResponse) {
  const project = await readProject();
  sendJson(response, 200, project);
}

async function handleProjectPut(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
) {
  const body = await readBody<ProjectData>(request);
  const saved = await writeProject(body);
  sendJson(response, 200, saved);
}

async function handleProjectReset(response: import("node:http").ServerResponse) {
  const project = await resetProject();
  sendJson(response, 200, project);
}

async function handleFigmaSync(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
) {
  const body = await readBody<FigmaSyncPayload>(request);
  const project = await readProject();

  const sourceId = `source-${slugify(body.source.name)}`;
  const syncedAt = nowIso();

  const nextSources = project.designSources.filter((item) => item.id !== sourceId);
  nextSources.unshift({
    id: sourceId,
    name: body.source.name,
    figmaFileKey: body.source.figmaFileKey,
    branch: body.source.branch,
    status: "connected",
    lastSyncedAt: syncedAt,
    summary: body.source.summary,
  });

  const nextScreens = project.designScreens.filter((screen) => screen.sourceId !== sourceId);
  const nextMappings = [...project.componentMappings];

  body.screens.forEach((screen) => {
    nextScreens.push({
      id: `screen-${slugify(screen.name)}`,
      sourceId,
      name: screen.name,
      purpose: screen.purpose,
      stateNotes: screen.stateNotes,
      summary: screen.summary,
    });
  });

  body.components.forEach((component) => {
    const mappingId = `mapping-${slugify(component.designName)}`;
    const existing = nextMappings.find((item) => item.id === mappingId);

    if (existing) {
      existing.designName = component.designName;
      existing.reactName = component.reactName;
      existing.props = component.props;
      existing.states = component.states;
      existing.notes = component.notes;
      existing.status = "prototype";
    } else {
      nextMappings.push({
        id: mappingId,
        designName: component.designName,
        reactName: component.reactName,
        props: component.props,
        states: component.states,
        notes: component.notes,
        status: "prototype",
        screenIds: [],
      });
    }
  });

  const saved = await writeProject({
    ...project,
    designSources: nextSources,
    designScreens: nextScreens,
    componentMappings: nextMappings,
  });

  sendJson(response, 200, saved);
}

async function handleContextPack(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
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

async function handleRuntimeRun(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
) {
  const contextPack = await readBody<ContextPack>(request);
  const result = runRuntimeAction(contextPack);
  sendJson(response, 200, result);
}

async function handlePluginBridgeSnapshot(response: import("node:http").ServerResponse) {
  const snapshot = await getPluginBridgeSnapshot();
  sendJson(response, 200, snapshot);
}

async function handlePluginSessionRegister(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
) {
  const payload = await readBody<PluginSessionRegistrationPayload>(request);
  const session = await registerPluginSession(payload);
  sendJson(response, 200, session);
}

async function handlePluginSessionHeartbeat(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
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
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
) {
  const payload = await readBody<QueuePluginCommandPayload>(request);
  const record = await queuePluginCommand(payload);
  sendJson(response, 200, record);
}

async function handlePluginCommandClaim(
  response: import("node:http").ServerResponse,
  sessionId: string,
) {
  const command = await claimNextPluginCommand(sessionId);
  sendJson(response, 200, { command });
}

async function handlePluginCommandResult(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
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

async function serveStaticAsset(
  response: import("node:http").ServerResponse,
  pathname: string,
): Promise<boolean> {
  try {
    await access(distDirectory);
  } catch {
    return false;
  }

  const targetPath =
    pathname === "/"
      ? path.join(distDirectory, "index.html")
      : path.join(distDirectory, pathname.replace(/^\/+/, ""));

  try {
    const asset = await readFile(targetPath);
    const extension = path.extname(targetPath);
    const contentType =
      extension === ".js"
        ? "text/javascript; charset=utf-8"
        : extension === ".css"
          ? "text/css; charset=utf-8"
          : extension === ".html"
            ? "text/html; charset=utf-8"
            : extension === ".svg"
              ? "image/svg+xml"
              : "application/octet-stream";

    response.writeHead(200, { "Content-Type": contentType });
    response.end(asset);
    return true;
  } catch {
    if (pathname !== "/") {
      try {
        const indexHtml = await readFile(path.join(distDirectory, "index.html"));
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(indexHtml);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

async function routeRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  context: RequestContext,
) {
  const pathSegments = context.pathname.split("/").filter(Boolean);

  if (context.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }

  if (context.pathname === "/api/health" && context.method === "GET") {
    sendJson(response, 200, {
      ok: true,
      service: "autodesign-api",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (context.pathname === "/api/project" && context.method === "GET") {
    await handleProjectGet(response);
    return;
  }

  if (context.pathname === "/api/project" && context.method === "PUT") {
    await handleProjectPut(request, response);
    return;
  }

  if (context.pathname === "/api/project/reset" && context.method === "POST") {
    await handleProjectReset(response);
    return;
  }

  if (context.pathname === "/api/figma/sync" && context.method === "POST") {
    await handleFigmaSync(request, response);
    return;
  }

  if (context.pathname === "/api/runtime/context-pack" && context.method === "POST") {
    await handleContextPack(request, response);
    return;
  }

  if (context.pathname === "/api/runtime/run" && context.method === "POST") {
    await handleRuntimeRun(request, response);
    return;
  }

  if (context.pathname === "/api/plugin-bridge" && context.method === "GET") {
    await handlePluginBridgeSnapshot(response);
    return;
  }

  if (context.pathname === "/api/plugin-bridge/sessions/register" && context.method === "POST") {
    await handlePluginSessionRegister(request, response);
    return;
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
    return;
  }

  if (context.pathname === "/api/plugin-bridge/commands" && context.method === "POST") {
    await handlePluginCommandQueue(request, response);
    return;
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
    return;
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
    return;
  }

  if (context.method === "GET" && !(await serveStaticAsset(response, context.pathname))) {
    sendText(response, 404, "Not found");
    return;
  }

  if (context.method !== "GET") {
    sendJson(response, 404, { ok: false, error: "Route not found" });
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    await routeRequest(request, response, {
      pathname: url.pathname,
      method: request.method ?? "GET",
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});

server.listen(port, () => {
  console.log(`AutoDesign API listening on http://localhost:${port}`);
});
