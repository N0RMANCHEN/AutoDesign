import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  RuntimeMetadataSnapshot,
  RuntimeDesignContext,
  RuntimeVariableDefsContext,
} from "../shared/runtime-design-context.js";
import type { RuntimeBridgeOverview } from "../shared/runtime-bridge-overview.js";
import type { RuntimeNodeMetadataSnapshot } from "../shared/runtime-node-metadata.js";
import type { RuntimeScreenshotSnapshot } from "../shared/runtime-screenshot.js";

const BASE_URL =
  process.env.AUTODESIGN_API_URL ??
  process.env.FIGMATEST_API_URL ??
  "http://localhost:3001";
const apiFixtureDirectory = process.env.AUTODESIGN_API_FIXTURE_DIR
  ? path.resolve(process.env.AUTODESIGN_API_FIXTURE_DIR)
  : null;

type Mode =
  | "bridge_overview"
  | "get_design_context"
  | "get_metadata"
  | "get_node_metadata"
  | "get_screenshot"
  | "get_variable_defs";

export type RuntimeReadRequest = {
  mode: Mode;
  pathname: string;
  init?: RequestInit;
};

function fail(message: string): never {
  throw new Error(message);
}

function usage() {
  return [
    "Usage:",
    "  npm run runtime:read -- bridge_overview",
    "  npm run runtime:read -- get_design_context --selection-ids mapping-button-primary --session session_test",
    "  npm run runtime:read -- get_metadata --selection-ids mapping-button-primary",
    "  npm run runtime:read -- get_variable_defs --selection-ids mapping-button-primary --session session_test",
    "  npm run runtime:read -- get_node_metadata --session session_test --node-id 1:2 --allow-live-inspect",
    "  npm run runtime:read -- get_screenshot --session session_test --node-id 1:2 --allow-live-export --out data/runtime/node.png",
  ].join("\n");
}

function parseMode(argv: string[]): Mode {
  const mode = argv[2];
  if (
    mode === "bridge_overview" ||
    mode === "get_design_context" ||
    mode === "get_metadata" ||
    mode === "get_node_metadata" ||
    mode === "get_screenshot" ||
    mode === "get_variable_defs"
  ) {
    return mode;
  }
  fail(usage());
}

function readFlag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  return argv[index + 1] ?? null;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

function readRequiredValueFlag(argv: string[], name: string) {
  const value = readFlag(argv, name);
  if (!value || value.startsWith("--")) {
    fail(`${name} is required`);
  }
  return value;
}

function readValueFlag(argv: string[], name: string) {
  const value = readFlag(argv, name);
  if (!value || value.startsWith("--")) {
    return null;
  }
  return value;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function toFixtureName(pathname: string, method: string) {
  const normalizedPath = pathname.replace(/^\//, "").replace(/[/?=&:]+/g, "__");
  const normalizedMethod = method.toLowerCase();
  return `${normalizedMethod}__${normalizedPath || "root"}.json`;
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  if (apiFixtureDirectory) {
    const method = String(init?.method || "GET").toUpperCase();
    const fixturePath = path.join(apiFixtureDirectory, toFixtureName(pathname, method));
    return readJsonFile<T>(fixturePath);
  }

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${pathname}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    fail(
      `Request failed: ${BASE_URL}${pathname} (${error instanceof Error ? error.message : "network error"})`,
    );
  }

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error) {
        detail = `${detail} - ${payload.error}`;
      }
    } catch {
      // Ignore non-JSON error bodies.
    }
    fail(`Request failed: ${detail}`);
  }

  return (await response.json()) as T;
}

function parseSelectionIds(argv: string[]) {
  const raw = readValueFlag(argv, "--selection-ids");
  if (!raw) {
    return [];
  }
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function readSessionId(argv: string[]) {
  return readValueFlag(argv, "--session");
}

function readRequiredSessionId(argv: string[]) {
  return readRequiredValueFlag(argv, "--session");
}

function parseIntegerFlag(argv: string[], name: string) {
  const raw = readValueFlag(argv, name);
  if (!raw) {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    fail(`${name} must be an integer`);
  }
  return value;
}

function parseNumberFlag(argv: string[], name: string) {
  const raw = readValueFlag(argv, name);
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    fail(`${name} must be a number`);
  }
  return value;
}

function resolveGraphKind(action: string | null, explicitGraphKind: string | null) {
  if (explicitGraphKind === "codegraph" || explicitGraphKind === "knowledge") {
    return explicitGraphKind;
  }
  if (!explicitGraphKind && action?.startsWith("knowledge/")) {
    return "knowledge";
  }
  if (explicitGraphKind) {
    fail("--graph-kind must be codegraph or knowledge");
  }
  return null;
}

function parseConstraint(argv: string[]) {
  const typeRaw = readValueFlag(argv, "--constraint-type");
  const value = parseNumberFlag(argv, "--constraint-value");
  if (!typeRaw && value === null) {
    return null;
  }
  if (!typeRaw || value === null) {
    fail("--constraint-type and --constraint-value must be provided together");
  }
  const type = String(typeRaw).toUpperCase();
  if (type !== "WIDTH" && type !== "HEIGHT" && type !== "SCALE") {
    fail("--constraint-type must be WIDTH, HEIGHT or SCALE");
  }
  return {
    type,
    value,
  } as const;
}

function decodeDataUrl(dataUrl: string, label: string) {
  const match = /^data:[^;]+;base64,(.+)$/.exec(String(dataUrl || ""));
  if (!match) {
    fail(`${label} is not a valid base64 data URL`);
  }
  return Buffer.from(match[1], "base64");
}

async function maybeWriteScreenshotArtifact(
  argv: string[],
  payload: RuntimeScreenshotSnapshot,
) {
  const outPath = readValueFlag(argv, "--out");
  if (!outPath || !payload.available || !payload.screenshot) {
    return payload;
  }

  const resolvedOutPath = path.resolve(outPath);
  await mkdir(path.dirname(resolvedOutPath), { recursive: true });
  await writeFile(
    resolvedOutPath,
    decodeDataUrl(payload.screenshot.dataUrl, `Screenshot ${payload.nodeId || "selection"}`),
  );
  return {
    ...payload,
    artifactPath: resolvedOutPath,
  };
}

export function buildRuntimeReadRequest(argv: string[]): RuntimeReadRequest {
  const mode = parseMode(argv);
  const action = readValueFlag(argv, "--action");
  const graphKind = mode === "get_design_context"
    ? resolveGraphKind(action, readValueFlag(argv, "--graph-kind"))
    : null;
  const sessionId = readSessionId(argv);
  const nodeId = readValueFlag(argv, "--node-id");
  const maxDepth = parseIntegerFlag(argv, "--max-depth");
  const constraint = parseConstraint(argv);
  const selectionIds = parseSelectionIds(argv);

  if (mode === "bridge_overview") {
    return {
      mode,
      pathname: "/api/runtime/bridge-overview",
    };
  }

  if (mode === "get_design_context") {
    return {
      mode,
      pathname: "/api/runtime/design-context",
      init: {
        method: "POST",
        body: JSON.stringify({
          selectionIds,
          ...(graphKind ? { graphKind } : {}),
          ...(action ? { action } : {}),
          ...(sessionId ? { targetSessionId: sessionId } : {}),
        }),
      },
    };
  }

  if (mode === "get_metadata") {
    return {
      mode,
      pathname: "/api/runtime/metadata",
      init: {
        method: "POST",
        body: JSON.stringify({
          selectionIds,
        }),
      },
    };
  }

  if (mode === "get_variable_defs") {
    return {
      mode,
      pathname: "/api/runtime/variable-defs",
      init: {
        method: "POST",
        body: JSON.stringify({
          selectionIds,
          ...(sessionId ? { targetSessionId: sessionId } : {}),
        }),
      },
    };
  }

  if (mode === "get_node_metadata") {
    return {
      mode,
      pathname: "/api/runtime/node-metadata",
      init: {
        method: "POST",
        body: JSON.stringify({
          targetSessionId: readRequiredSessionId(argv),
          ...(nodeId ? { nodeId } : {}),
          ...(hasFlag(argv, "--allow-live-inspect") ? { allowLiveInspect: true } : {}),
          ...(maxDepth !== null ? { maxDepth } : {}),
        }),
      },
    };
  }

  return {
    mode,
    pathname: "/api/runtime/screenshot",
    init: {
      method: "POST",
      body: JSON.stringify({
        targetSessionId: readRequiredSessionId(argv),
        ...(nodeId ? { nodeId } : {}),
        ...(hasFlag(argv, "--allow-live-export") ? { allowLiveExport: true } : {}),
        ...(hasFlag(argv, "--prefer-original-bytes") ? { preferOriginalBytes: true } : {}),
        ...(constraint ? { constraint } : {}),
      }),
    },
  };
}

export async function main(argv = process.argv) {
  const request = buildRuntimeReadRequest(argv);

  if (request.mode === "get_screenshot") {
    const payload = await requestJson<RuntimeScreenshotSnapshot>(request.pathname, request.init);
    const output = await maybeWriteScreenshotArtifact(argv, payload);
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const payload = await requestJson<
    | RuntimeBridgeOverview
    | RuntimeDesignContext
    | RuntimeMetadataSnapshot
    | RuntimeVariableDefsContext
    | RuntimeNodeMetadataSnapshot
  >(request.pathname, request.init);
  console.log(JSON.stringify(payload, null, 2));
}

function isDirectExecution() {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }
  return pathToFileURL(path.resolve(entryPoint)).href === import.meta.url;
}

if (isDirectExecution()) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(message);
    process.exitCode = 1;
  });
}
