import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sendJson, sendText } from "./http-utils.js";
import {
  createDefaultReconstructionExecutionDeps,
} from "./reconstruction-server-runtime.js";
import { tryHandlePluginBridgeRoute } from "./routes/plugin-bridge-routes.js";
import { tryHandleReconstructionDesignRoute } from "./routes/reconstruction-design-routes.js";
import { tryHandleReconstructionExecutionRoute } from "./routes/reconstruction-execution-routes.js";
import type { RequestContext } from "./routes/request-context.js";
import { tryHandleRuntimeReadRoute } from "./routes/runtime-read-routes.js";
import { tryHandleRuntimeWriteRoute } from "./routes/runtime-write-routes.js";
import { tryHandleWorkspaceRoute } from "./routes/workspace-routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.resolve(__dirname, "..");
const distDirectory = path.join(rootDirectory, "dist");
const port = Number(process.env.PORT ?? 3001);

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

  if (await tryHandleWorkspaceRoute(request, response, context)) {
    return;
  }

  if (await tryHandleRuntimeReadRoute(request, response, context)) {
    return;
  }

  if (await tryHandleRuntimeWriteRoute(request, response, context)) {
    return;
  }

  if (await tryHandlePluginBridgeRoute(request, response, context)) {
    return;
  }

  if (await tryHandleReconstructionDesignRoute(request, response, context)) {
    return;
  }

  if (await tryHandleReconstructionExecutionRoute(response, context, createDefaultReconstructionExecutionDeps())) {
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

export async function handleAutoDesignRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
) {
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
}

export function createAutoDesignServer() {
  return createServer(handleAutoDesignRequest);
}

export function startAutoDesignServer(listenPort = port) {
  const server = createAutoDesignServer();
  server.listen(listenPort, () => {
    console.log(`AutoDesign API listening on http://localhost:${listenPort}`);
  });
  return server;
}

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === __filename;

if (isMainModule) {
  startAutoDesignServer();
}
