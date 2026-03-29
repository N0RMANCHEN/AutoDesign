import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runCodeToDesignCaptureCli } from "./code-to-design-capture.js";
import {
  buildCodeToDesignPlan,
  type CodeToDesignLayoutNode,
  type CodeToDesignTextRasterOverride,
} from "../shared/code-to-design-plan.js";
import { buildCodeToDesignQualityReport } from "../shared/code-to-design-quality.js";
import {
  buildCodeToDesignFontInstallAssessment,
  loadCodeToDesignFontManifest,
  normalizeCodeToDesignSnapshotFonts,
  resolveCodeToDesignFontBundleRoot,
  syncCodeToDesignFontBundle,
  type CodeToDesignFontInstallAssessment,
} from "../shared/code-to-design-fonts.js";
import {
  buildCodeToDesignRuntimeSnapshot,
  combineResponsiveCodeToDesignSnapshots,
  getResponsiveVariantSnapshot,
  type CodeToDesignRuntimeSnapshot,
} from "../shared/code-to-design-snapshot.js";
import {
  type InspectFrameResponsePayload,
  type PluginAvailableFont,
  type PluginBridgeCommandRecord,
  type PluginBridgeSession,
  type PluginBridgeSnapshot,
  type PluginFontLoadProbeResult,
  type PluginImageArtifact,
  type PluginNodeInspection,
  type QueuePluginCommandPayload,
} from "../shared/plugin-bridge.js";
import type { FigmaCapabilityCommand } from "../shared/plugin-contract.js";

type DiffMetrics = {
  globalSimilarity: number;
  colorDelta: number;
  edgeSimilarity: number;
  layoutSimilarity: number;
  structureSimilarity: number;
  hotspotAverage: number;
  hotspotPeak: number;
  hotspotCoverage: number;
  compositeScore: number;
  grade: string;
  acceptanceGates: Array<{
    id: string;
    label: string;
    metric: string;
    comparator: string;
    threshold: number;
    actual: number;
    passed: boolean;
    hard: boolean;
  }>;
  hotspots: Array<{
    id: string;
    score: number;
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
};

type SectionDiffResult = {
  id: string;
  label: string;
  metrics: DiffMetrics;
  artifactPath: string;
};

type ResponsiveProbe = {
  viewportKey: "desktop" | "tablet" | "mobile";
  width: number;
};

type ResponsiveProbeResult = {
  viewportKey: string;
  browserScreenshotPath: string;
  snapshotPath: string;
  snapshot: CodeToDesignRuntimeSnapshot;
  figmaScreenshotPath: string;
  inspectPath: string;
  fullDiffPath: string;
  fullDiff: DiffMetrics;
  sectionDiffs: SectionDiffResult[];
  quality: ReturnType<typeof buildCodeToDesignQualityReport>;
};

type RuntimeProbeReport = {
  status: "pass" | "fail";
  notes: string[];
  createCommand: PluginBridgeCommandRecord;
  deleteCommand: PluginBridgeCommandRecord | null;
};

type FontEnvironmentDiagnostics = {
  kind: "code_to_design_font_environment_diagnostics";
  version: "v1";
  sessionId: string;
  manifestPath: string | null;
  requiredFonts: Array<{
    requestedFamily: string;
    requestedStyle: string | null;
    figmaFamily: string;
    figmaStyle: string | null;
    manifestFile: string | null;
    manifestPostscriptName: string | null;
    sourcePath: string | null;
    sourceKind: "bundle_manifest" | "web_asset" | "system_font" | null;
    installSourcePath: string | null;
    installTargetPath: string | null;
    usedSplitFace: boolean;
    splitSourcePath: string | null;
    splitError: string | null;
    splitFaces: Array<{
      family: string;
      style: string;
      postscriptName: string;
      filePath: string;
    }>;
    catalogVisible: boolean;
    directLoadProbe: PluginFontLoadProbeResult | null;
    verdict: "pass" | "fail";
  }>;
  installedFiles: string[];
  skippedFiles: string[];
  fontCatalog: PluginAvailableFont[];
  directLoadResults: PluginFontLoadProbeResult[];
  verdict: {
    status: "pass" | "fail";
    missingFonts: Array<{
      family: string;
      style: string | null;
    }>;
  };
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const diffScriptPath = path.join(repoRoot, "scripts", "measure_reconstruction_diff.py");
const cropPngScriptPath = path.join(repoRoot, "scripts", "crop_png.py");
const BASE_URL =
  process.env.AUTODESIGN_API_URL ??
  process.env.FIGMATEST_API_URL ??
  "http://localhost:3001";
const MAX_RASTER_TILE_EDGE = 4000;
const pluginCommandWaitTimeoutMs = 600_000;
const pluginCommandPollIntervalMs = 300;
const RESPONSIVE_PROBES: ResponsiveProbe[] = [
  { viewportKey: "desktop", width: 1496 },
  { viewportKey: "tablet", width: 1180 },
  { viewportKey: "mobile", width: 760 },
];

function fail(message: string): never {
  throw new Error(message);
}

function readFlag(argv: string[], name: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function readFlags(argv: string[], name: string) {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) {
      continue;
    }
    const value = argv[index + 1] ?? null;
    if (value && !value.startsWith("--")) {
      values.push(value);
    }
  }
  return values;
}

function hasFlag(argv: string[], name: string) {
  return argv.includes(name);
}

async function requestJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${pathname}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
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

function nowTimestamp() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
  ].join("") +
    "-" +
    [pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join("");
}

function decodePngDataUrl(dataUrl: string, label: string) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ""));
  if (!match) {
    fail(`${label} did not contain a PNG data URL.`);
  }
  return Buffer.from(match[1], "base64");
}

async function writeJsonArtifact(artifactPath: string, payload: unknown) {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function writePngArtifact(artifactPath: string, dataUrl: string, label: string) {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, decodePngDataUrl(dataUrl, label));
}

function sortSessions(sessions: PluginBridgeSession[]) {
  return [...sessions].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickSession(
  sessions: PluginBridgeSession[],
  explicitSessionId: string | null,
) {
  if (!sessions.length) {
    fail("No online AutoDesign plugin session is available.");
  }
  if (explicitSessionId) {
    const found = sessions.find((session) => session.id === explicitSessionId) || null;
    if (!found) {
      fail(`Plugin session not found: ${explicitSessionId}`);
    }
    return found;
  }
  return sortSessions(sessions)[0]!;
}

async function requireOnlineSession(sessionId: string) {
  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = snapshot.sessions.find((item) => item.id === sessionId) || null;
  if (!session) {
    fail(`Plugin session not found: ${sessionId}`);
  }
  if (session.status !== "online") {
    fail(`Plugin session ${sessionId} is not online.`);
  }
  return session;
}

async function waitForQueuedCommand(commandId: string, targetSessionId?: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= pluginCommandWaitTimeoutMs) {
    const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
    const command = snapshot.commands.find((item) => item.id === commandId) || null;
    if (command && (command.status === "succeeded" || command.status === "failed")) {
      return command;
    }
    if (targetSessionId) {
      const session = snapshot.sessions.find((item) => item.id === targetSessionId) || null;
      if (!session) {
        fail(`Plugin session not found while waiting for command ${commandId}: ${targetSessionId}`);
      }
      if (session.status !== "online") {
        fail(`Plugin session ${targetSessionId} went ${session.status} while waiting for command ${commandId}. Reopen AutoDesign and rerun acceptance.`);
      }
    }
    await sleep(pluginCommandPollIntervalMs);
  }
  fail(`Timed out waiting for plugin command ${commandId}.`);
}

async function queueAndWaitForPluginBatch(
  targetSessionId: string,
  commands: FigmaCapabilityCommand[],
) {
  if (!commands.length) {
    fail("No reconstruction commands to execute.");
  }

  await requireOnlineSession(targetSessionId);

  const queued = await requestJson<PluginBridgeCommandRecord>("/api/plugin-bridge/commands", {
    method: "POST",
    body: JSON.stringify({
      targetSessionId,
      source: "codex",
      payload: {
        source: "codex",
        issuedAt: new Date().toISOString(),
        commands: commands.map((command) => ({
          ...command,
          executionMode: "strict",
        })),
      },
    } satisfies QueuePluginCommandPayload),
  });

  return waitForQueuedCommand(queued.id, targetSessionId);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function collectCommandWarnings(command: PluginBridgeCommandRecord) {
  return uniqueStrings(command.results.flatMap((result) => result.warnings || []));
}

function assertSuccessfulCommandRecord(command: PluginBridgeCommandRecord, contextLabel: string) {
  if (command.status !== "succeeded") {
    fail(command.resultMessage || `${contextLabel} failed.`);
  }

  const failedResult = command.results.find((result) => !result.ok) || null;
  if (failedResult) {
    fail(failedResult.message || `${contextLabel} failed.`);
  }

  const warnings = collectCommandWarnings(command);
  if (warnings.length) {
    fail(`${contextLabel} returned warnings: ${warnings.join(" | ")}`);
  }
}

async function inspectFrameSubtree(
  targetSessionId: string,
  frameNodeId: string,
  options?: { maxDepth?: number },
) {
  const response = await requestJson<InspectFrameResponsePayload>("/api/plugin-bridge/inspect-frame", {
    method: "POST",
    body: JSON.stringify({
      targetSessionId,
      frameNodeId,
      includePreview: false,
      ...(Number.isFinite(options?.maxDepth) ? { maxDepth: options?.maxDepth } : {}),
    }),
  });
  return response.nodes;
}

async function exportSingleNodeImage(
  targetSessionId: string,
  nodeId: string,
) {
  const command = await queueAndWaitForPluginBatch(targetSessionId, [
    {
      type: "capability",
      capabilityId: "assets.export-node-image",
      nodeIds: [nodeId],
      payload: {},
      executionMode: "strict",
    },
  ]);
  assertSuccessfulCommandRecord(command, "Node image export");

  const artifact = command.results
    .flatMap((result) => result.exportedImages || [])
    .find((item) => item.nodeId === nodeId) as PluginImageArtifact | undefined;
  if (!artifact) {
    fail(`Node image export completed without artifact for node ${nodeId}.`);
  }
  return artifact;
}

async function resizeFrameNode(
  targetSessionId: string,
  nodeId: string,
  size: { width: number; height: number },
) {
  const command = await queueAndWaitForPluginBatch(targetSessionId, [
    {
      type: "capability",
      capabilityId: "geometry.set-size",
      nodeIds: [nodeId],
      payload: {
        width: Math.max(1, Math.round(size.width)),
        height: Math.max(1, Math.round(size.height)),
      },
      executionMode: "strict",
    },
  ]);
  assertSuccessfulCommandRecord(command, "Frame resize");
  return command;
}

function findLayoutNodeById(root: CodeToDesignLayoutNode, nodeId: string): CodeToDesignLayoutNode | null {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === nodeId) {
      return node;
    }
    stack.push(...[...node.children].reverse());
  }
  return null;
}

function normalizeCropBounds(
  root: CodeToDesignLayoutNode,
  node: CodeToDesignLayoutNode,
) {
  return {
    x: Number((node.rect.x / root.rect.width).toFixed(4)),
    y: Number((node.rect.y / root.rect.height).toFixed(4)),
    width: Number((node.rect.width / root.rect.width).toFixed(4)),
    height: Number((node.rect.height / root.rect.height).toFixed(4)),
  };
}

function rectForViewport(node: CodeToDesignLayoutNode, viewportKey: string) {
  return node.responsiveRules?.find((rule) => rule.viewportKey === viewportKey)?.rect || node.rect;
}

function materializeLayoutTreeForViewport(
  node: CodeToDesignLayoutNode,
  viewportKey: string,
): CodeToDesignLayoutNode {
  const rect = rectForViewport(node, viewportKey);
  return {
    ...node,
    rect,
    children: node.children.map((child) => materializeLayoutTreeForViewport(child, viewportKey)),
  };
}

function normalizeCropBoundsForViewport(
  root: CodeToDesignLayoutNode,
  node: CodeToDesignLayoutNode,
  viewportKey: string,
) {
  const rootRect = rectForViewport(root, viewportKey);
  const nodeRect = rectForViewport(node, viewportKey);
  return {
    x: Number((nodeRect.x / rootRect.width).toFixed(4)),
    y: Number((nodeRect.y / rootRect.height).toFixed(4)),
    width: Number((nodeRect.width / rootRect.width).toFixed(4)),
    height: Number((nodeRect.height / rootRect.height).toFixed(4)),
  };
}

function summarizeResponsiveProbe(
  viewportKey: string,
  quality: ReturnType<typeof buildCodeToDesignQualityReport>,
  fullDiff: DiffMetrics,
) {
  const score = Math.round(((quality.figmaTree.score + (quality.visualDiff.score ?? 0)) / 2) * 10) / 10;
  return {
    viewportKey,
    status:
      quality.figmaTree.status === "pass" && quality.visualDiff.status === "pass" ? "pass" : "fail",
    score,
    figmaTreeStatus: quality.figmaTree.status,
    visualDiffStatus: quality.visualDiff.status,
    compositeScore: fullDiff.compositeScore,
    artifactPaths: quality.visualDiff.artifactPaths,
    notes: [
      `figmaTree=${quality.figmaTree.status}`,
      `visualDiff=${quality.visualDiff.status}`,
      summarizeDiffMetrics(viewportKey, fullDiff),
    ],
  } as const;
}

function measureDiff(referenceImagePath: string, renderedImagePath: string, cropBounds?: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  const args = [diffScriptPath, referenceImagePath, renderedImagePath];
  if (cropBounds) {
    args.push("--crop", JSON.stringify(cropBounds));
  }
  const result = spawnSync("python3", args, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(result.stderr?.trim() || result.stdout?.trim() || "measure_reconstruction_diff.py failed");
  }
  return JSON.parse(result.stdout) as DiffMetrics;
}

function summarizeDiffMetrics(label: string, metrics: DiffMetrics) {
  const hardFailed = metrics.acceptanceGates.filter((gate) => gate.hard && !gate.passed);
  return `${label}: composite=${metrics.compositeScore.toFixed(4)} grade=${metrics.grade} hardFailed=${hardFailed.length}`;
}

function collectCreatedNodeReceipts(command: PluginBridgeCommandRecord) {
  return command.results.flatMap((result) => result.createdNodeReceipts || []);
}

function collectFontCatalog(command: PluginBridgeCommandRecord) {
  return command.results.flatMap((result) => result.fontCatalog || []) as PluginAvailableFont[];
}

function collectFontLoadResults(command: PluginBridgeCommandRecord) {
  return command.results.flatMap((result) => result.fontLoadResults || []) as PluginFontLoadProbeResult[];
}

function normalizeFontFamilyKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "");
}

function normalizeFontStyleKey(value: string | null | undefined) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "");
  if (!normalized || normalized === "regular" || normalized === "roman" || normalized === "normal" || normalized === "book") {
    return "regular";
  }
  if (normalized === "semibold" || normalized === "semibd") {
    return "semibold";
  }
  if (normalized === "bold") {
    return "bold";
  }
  if (normalized === "medium") {
    return "medium";
  }
  if (normalized === "light") {
    return "light";
  }
  return normalized;
}

function findMissingCatalogFonts(
  requiredFonts: Array<{ family: string; style: string | null }>,
  fontCatalog: PluginAvailableFont[],
) {
  return requiredFonts.filter(
    (required) =>
      !fontCatalog.some(
        (font) =>
          normalizeFontFamilyKey(font.family) === normalizeFontFamilyKey(required.family) &&
          normalizeFontStyleKey(font.style) === normalizeFontStyleKey(required.style),
      ),
  );
}

function mergeFontCatalog(
  fontCatalog: PluginAvailableFont[],
  fontLoadResults: PluginFontLoadProbeResult[],
) {
  const merged = [...fontCatalog];
  for (const result of fontLoadResults) {
    if (!result.ok) {
      continue;
    }
    const alreadyPresent = merged.some(
      (font) =>
        normalizeFontFamilyKey(font.family) === normalizeFontFamilyKey(result.family) &&
        normalizeFontStyleKey(font.style) === normalizeFontStyleKey(result.style),
    );
    if (alreadyPresent) {
      continue;
    }
    merged.push({
      family: result.family,
      style: result.style,
      familyKey: result.familyKey,
      styleKey: result.styleKey,
    });
  }
  return merged.sort((left, right) =>
    `${left.familyKey}::${left.styleKey}`.localeCompare(`${right.familyKey}::${right.styleKey}`),
  );
}

function sanitizeArtifactSegment(value: string) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "artifact";
}

function titleCaseViewportKey(viewportKey: string) {
  return viewportKey
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

async function encodePngFileAsDataUrl(filePath: string) {
  const buffer = await readFile(filePath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function cropPngFile(params: {
  sourcePath: string;
  outputPath: string;
  rect: { x: number; y: number; width: number; height: number };
}) {
  const result = spawnSync(
    "python3",
    [
      cropPngScriptPath,
      params.sourcePath,
      params.outputPath,
      JSON.stringify({
        x: params.rect.x,
        y: params.rect.y,
        width: params.rect.width,
        height: params.rect.height,
        targetWidth: Math.max(1, Math.round(params.rect.width)),
        targetHeight: Math.max(1, Math.round(params.rect.height)),
      }),
    ],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    fail(result.stderr?.trim() || result.stdout?.trim() || "crop_png.py failed");
  }
}

function collectRasterFallbackTextNodeIds(
  snapshot: CodeToDesignRuntimeSnapshot,
  missingCatalogFonts: Array<{ family: string; style: string | null }>,
) {
  const missingFontKeys = new Set(
    missingCatalogFonts.map(
      (font) => `${normalizeFontFamilyKey(font.family)}::${normalizeFontStyleKey(font.style)}`,
    ),
  );
  return snapshot.nodes
    .filter(
      (node) =>
        node.role === "text" &&
        node.resolvedBrowserFontFamily &&
        missingFontKeys.has(
          `${normalizeFontFamilyKey(node.resolvedBrowserFontFamily)}::${normalizeFontStyleKey(node.resolvedBrowserFontStyle)}`,
        ),
    )
    .map((node) => node.id);
}

async function buildTextRasterOverrides(params: {
  snapshot: CodeToDesignRuntimeSnapshot;
  browserScreenshotPath: string;
  rasterizedTextNodeIds: string[];
  artifactRoot: string;
  viewportKey: string;
}) {
  const overrides: Record<string, CodeToDesignTextRasterOverride> = {};
  const artifacts: Array<{
    nodeId: string;
    text: string | null;
    rect: { x: number; y: number; width: number; height: number };
    imagePath: string;
  }> = [];

  const nodeIndex = new Map(params.snapshot.nodes.map((node) => [node.id, node] as const));
  const rasterRoot = path.join(params.artifactRoot, "rasterized-text", sanitizeArtifactSegment(params.viewportKey));
  await mkdir(rasterRoot, { recursive: true });
  for (const nodeId of params.rasterizedTextNodeIds) {
    const node = nodeIndex.get(nodeId) || null;
    if (!node || node.role !== "text") {
      continue;
    }
    const imagePath = path.join(rasterRoot, `${sanitizeArtifactSegment(nodeId)}.png`);
    await cropPngFile({
      sourcePath: params.browserScreenshotPath,
      outputPath: imagePath,
      rect: node.rect,
    });
    overrides[nodeId] = {
      dataUrl: await encodePngFileAsDataUrl(imagePath),
      fitMode: "stretch",
    };
    artifacts.push({
      nodeId,
      text: node.textContent,
      rect: node.rect,
      imagePath,
    });
  }

  return {
    overrides,
    artifacts,
  };
}

function buildRasterFallbackQualitySnapshot(
  snapshot: CodeToDesignRuntimeSnapshot,
  rasterizedTextNodeIds: Set<string>,
) {
  const normalizeNodes = (nodes: typeof snapshot.nodes) =>
    nodes.map((node) => {
      if (!rasterizedTextNodeIds.has(node.id) || node.role !== "text") {
        return node;
      }
      return {
        ...node,
        role: "image" as const,
        textContent: null,
        resolvedBrowserFontFamily: null,
        resolvedBrowserFontStyle: null,
        image: node.image || { src: null, alt: null, dataUrl: null },
      };
    });

  const primaryNodes = normalizeNodes(snapshot.nodes);
  return buildCodeToDesignRuntimeSnapshot({
    projectRoot: snapshot.projectRoot,
    projectName: snapshot.projectName,
    route: snapshot.route,
    entryPaths: snapshot.entryPaths,
    viewportKey: snapshot.viewportKey,
    viewport: snapshot.viewport,
    page: snapshot.page,
    nodes: primaryNodes,
    responsiveVariants: snapshot.responsiveVariants?.map((variant) => ({
      viewportKey: variant.viewportKey,
      viewport: variant.viewport,
      page: variant.page,
      nodes: normalizeNodes(variant.nodes),
    })),
    warnings: snapshot.warnings,
  });
}

function filterFontInstallAssessmentForRasterizedText(params: {
  fontInstall: CodeToDesignFontInstallAssessment;
  snapshot: CodeToDesignRuntimeSnapshot;
  rasterizedTextNodeIds: Set<string>;
}) {
  const visibleNodeIds = new Set(params.snapshot.nodes.map((node) => node.id));
  const requiredFonts = params.fontInstall.requiredFonts.filter((requirement) =>
    requirement.sourceNodeIds.some((nodeId) => visibleNodeIds.has(nodeId) && !params.rasterizedTextNodeIds.has(nodeId)),
  );
  const missingBrowserResolvedNodeIds = params.fontInstall.missingBrowserResolvedNodeIds.filter(
    (nodeId) => visibleNodeIds.has(nodeId) && !params.rasterizedTextNodeIds.has(nodeId),
  );
  const notes = [...params.fontInstall.notes];
  if (params.rasterizedTextNodeIds.size) {
    notes.push(
      `rasterized missing-font text nodes bypass exact font gating: ${[...params.rasterizedTextNodeIds].join(", ")}`,
    );
  }
  return {
    ...params.fontInstall,
    requiredFonts,
    missingBrowserResolvedNodeIds,
    notes: uniqueStrings(notes),
  } satisfies CodeToDesignFontInstallAssessment;
}

async function inspectRuntimeFontCatalog(targetSessionId: string) {
  const command = await queueAndWaitForPluginBatch(targetSessionId, [
    {
      type: "capability",
      capabilityId: "runtime.inspect-font-catalog",
      payload: {},
      executionMode: "strict",
    },
  ]);
  assertSuccessfulCommandRecord(command, "Runtime font catalog probe");
  return {
    command,
    fontCatalog: collectFontCatalog(command),
  };
}

async function probeRuntimeFontLoad(
  targetSessionId: string,
  fonts: Array<{ family: string; style: string | null }>,
) {
  const requestedFonts = fonts
    .map((font) => ({
      family: String(font.family || "").trim(),
      style: String(font.style || "").trim() || "Regular",
    }))
    .filter((font) => font.family);
  if (!requestedFonts.length) {
    return {
      command: null,
      fontLoadResults: [] as PluginFontLoadProbeResult[],
    };
  }

  const command = await queueAndWaitForPluginBatch(targetSessionId, [
    {
      type: "capability",
      capabilityId: "runtime.probe-font-load",
      payload: {
        fonts: requestedFonts,
      },
      executionMode: "strict",
    },
  ]);

  if (command.status !== "succeeded") {
    fail(command.resultMessage || "Runtime font load probe failed.");
  }
  const failedResult = command.results.find((result) => !result.ok) || null;
  if (failedResult) {
    fail(failedResult.message || "Runtime font load probe failed.");
  }

  return {
    command,
    fontLoadResults: collectFontLoadResults(command),
  };
}

function buildFontEnvironmentDiagnostics(params: {
  sessionId: string;
  fontManifestPath: string | null;
  fontPreflight: CodeToDesignFontInstallAssessment;
  fontCatalog: PluginAvailableFont[];
  directLoadResults: PluginFontLoadProbeResult[];
}) {
  const directLoadIndex = new Map<string, PluginFontLoadProbeResult>();
  for (const result of params.directLoadResults) {
    directLoadIndex.set(
      `${normalizeFontFamilyKey(result.family)}::${normalizeFontStyleKey(result.style)}`,
      result,
    );
  }

  const requiredFonts = params.fontPreflight.resolvedFonts.map((font) => {
    const catalogVisible = params.fontCatalog.some(
      (available) =>
        normalizeFontFamilyKey(available.family) === normalizeFontFamilyKey(font.figmaFamily) &&
        normalizeFontStyleKey(available.style) === normalizeFontStyleKey(font.figmaStyle),
    );
    const directLoadProbe =
      directLoadIndex.get(
        `${normalizeFontFamilyKey(font.figmaFamily)}::${normalizeFontStyleKey(font.figmaStyle)}`,
      ) || null;
    return {
      requestedFamily: font.requestedFamily,
      requestedStyle: font.requestedStyle,
      figmaFamily: font.figmaFamily,
      figmaStyle: font.figmaStyle,
      manifestFile: font.manifestFile,
      manifestPostscriptName: font.manifestPostscriptName,
      sourcePath: font.sourcePath,
      sourceKind: font.sourceKind,
      installSourcePath: font.installSourcePath,
      installTargetPath: font.installTargetPath,
      usedSplitFace: font.usedSplitFace,
      splitSourcePath: font.splitSourcePath,
      splitError: font.splitError,
      splitFaces: font.splitFaces,
      catalogVisible,
      directLoadProbe,
      verdict: catalogVisible || directLoadProbe?.ok ? "pass" : "fail",
    } as const;
  });

  const missingFonts = requiredFonts
    .filter((font) => font.verdict === "fail")
    .map((font) => ({
      family: font.figmaFamily,
      style: font.figmaStyle,
    }));

  return {
    kind: "code_to_design_font_environment_diagnostics",
    version: "v1",
    sessionId: params.sessionId,
    manifestPath: params.fontManifestPath,
    requiredFonts,
    installedFiles: params.fontPreflight.installedFiles,
    skippedFiles: params.fontPreflight.skippedFiles,
    fontCatalog: params.fontCatalog,
    directLoadResults: params.directLoadResults,
    verdict: {
      status: missingFonts.length ? "fail" : "pass",
      missingFonts,
    },
  } satisfies FontEnvironmentDiagnostics;
}

async function runRuntimeReceiptProbe(params: {
  sessionId: string;
  parentNodeId: string;
}) {
  const createCommand = await queueAndWaitForPluginBatch(params.sessionId, [
    {
      type: "capability",
      capabilityId: "nodes.create-text",
      payload: {
        parentNodeId: params.parentNodeId,
        name: "Runtime Receipt Probe",
        content: "Probe",
        x: -10000,
        y: -10000,
        fontFamily: "Inter",
        fontFamilyCandidates: ["Inter"],
        fontStyle: "Regular",
        resolvedBrowserFontFamily: "Inter",
        resolvedBrowserFontStyle: "Regular",
        analysisRefId: "code-to-design:probe:text",
      },
      executionMode: "strict",
    },
  ]);

  const notes: string[] = [];
  const receipts = collectCreatedNodeReceipts(createCommand);
  const probeReceipt =
    receipts.find((receipt) => receipt.analysisRefId === "code-to-design:probe:text") || null;
  if (!probeReceipt) {
    notes.push("runtime probe did not return createdNodeReceipts; reload the Figma plugin from the latest dist build.");
  } else if (!probeReceipt.fontResolution) {
    notes.push("runtime probe did not return fontResolution; reload the Figma plugin from the latest dist build.");
  }

  let deleteCommand: PluginBridgeCommandRecord | null = null;
  if (probeReceipt?.nodeId) {
    deleteCommand = await queueAndWaitForPluginBatch(params.sessionId, [
      {
        type: "capability",
        capabilityId: "nodes.delete",
        nodeIds: [probeReceipt.nodeId],
        payload: {},
        executionMode: "strict",
      },
    ]);
  }

  return {
    status: notes.length ? "fail" : "pass",
    notes,
    createCommand,
    deleteCommand,
  } satisfies RuntimeProbeReport;
}

async function maybeReplaceExistingFrame(params: {
  replaceNodeId: string | null;
  sessionId: string;
  commandPath: string;
}) {
  if (!params.replaceNodeId) {
    return null;
  }
  const deleteCommand: FigmaCapabilityCommand = {
    type: "capability",
    capabilityId: "nodes.delete",
    nodeIds: [params.replaceNodeId],
    payload: {},
  };
  const deleteResult = await queueAndWaitForPluginBatch(params.sessionId, [deleteCommand]);
  await writeJsonArtifact(params.commandPath, deleteResult);
  return deleteResult;
}

async function createVerticalDeliveryFrame(params: {
  sessionId: string;
  parentNodeId: string;
  name: string;
  analysisRefId: string;
  commandPath?: string;
}) {
  const command = await queueAndWaitForPluginBatch(params.sessionId, [
    {
      type: "capability",
      capabilityId: "nodes.create-frame",
      payload: {
        name: params.name,
        width: 16,
        height: 16,
        parentNodeId: params.parentNodeId,
        analysisRefId: params.analysisRefId,
      },
      executionMode: "strict",
    },
    {
      type: "capability",
      capabilityId: "layout.configure-frame",
      nodeIds: [`analysis:${params.analysisRefId}`],
      payload: {
        layoutMode: "VERTICAL",
        primaryAxisSizingMode: "AUTO",
        counterAxisSizingMode: "AUTO",
        primaryAxisAlignItems: "MIN",
        counterAxisAlignItems: "MIN",
        itemSpacing: 40,
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 24,
        paddingBottom: 24,
      },
      executionMode: "strict",
    },
  ]);
  if (params.commandPath) {
    await writeJsonArtifact(params.commandPath, command);
  }
  assertSuccessfulCommandRecord(command, `${params.name} creation`);
  const receipt =
    collectCreatedNodeReceipts(command).find((item) => item.analysisRefId === params.analysisRefId) || null;
  if (!receipt?.nodeId) {
    fail(`${params.name} creation did not return a node receipt.`);
  }
  return {
    command,
    nodeId: receipt.nodeId,
  };
}

async function createExactViewportVariant(params: {
  sessionId: string;
  parentNodeId: string;
  viewportKey: string;
  frameName: string;
  browserScreenshotPath: string;
  width: number;
  height: number;
  artifactRoot: string;
}) {
  const analysisRefId = `code-to-design:exact:${sanitizeArtifactSegment(params.viewportKey)}`;
  const applyCommandPath = path.join(params.artifactRoot, `exact-apply-${params.viewportKey}.json`);
  const tileRoot = path.join(params.artifactRoot, "exact-tiles", sanitizeArtifactSegment(params.viewportKey));
  await mkdir(tileRoot, { recursive: true });
  const tileHeight = Math.min(MAX_RASTER_TILE_EDGE, Math.max(1, Math.round(params.height)));
  const tiles: Array<{
    index: number;
    x: number;
    y: number;
    width: number;
    height: number;
    imagePath: string;
    dataUrl: string;
  }> = [];
  let tileIndex = 0;
  for (let y = 0; y < params.height; y += tileHeight) {
    const height = Math.min(tileHeight, params.height - y);
    const imagePath = path.join(tileRoot, `tile-${String(tileIndex + 1).padStart(2, "0")}.png`);
    await cropPngFile({
      sourcePath: params.browserScreenshotPath,
      outputPath: imagePath,
      rect: {
        x: 0,
        y,
        width: params.width,
        height,
      },
    });
    tiles.push({
      index: tileIndex,
      x: 0,
      y,
      width: Math.max(1, Math.round(params.width)),
      height: Math.max(1, Math.round(height)),
      imagePath,
      dataUrl: await encodePngFileAsDataUrl(imagePath),
    });
    tileIndex += 1;
  }
  const tileManifestPath = path.join(params.artifactRoot, `exact-tiles-${params.viewportKey}.json`);
  await writeJsonArtifact(tileManifestPath, {
    viewportKey: params.viewportKey,
    tiles: tiles.map((tile) => ({
      index: tile.index,
      x: tile.x,
      y: tile.y,
      width: tile.width,
      height: tile.height,
      imagePath: tile.imagePath,
    })),
  });

  const applyCommand = await queueAndWaitForPluginBatch(params.sessionId, [
    {
      type: "capability",
      capabilityId: "nodes.create-frame",
      payload: {
        name: params.frameName,
        width: Math.max(1, Math.round(params.width)),
        height: Math.max(1, Math.round(params.height)),
        parentNodeId: params.parentNodeId,
        analysisRefId,
      },
      executionMode: "strict",
    },
    {
      type: "capability",
      capabilityId: "nodes.set-clips-content",
      nodeIds: [`analysis:${analysisRefId}`],
      payload: {
        value: true,
      },
      executionMode: "strict",
    },
    ...tiles.map((tile) => ({
      type: "capability" as const,
      capabilityId: "nodes.create-image" as const,
      payload: {
        name: `${params.frameName} Tile ${tile.index + 1}`,
        imageDataUrl: tile.dataUrl,
        width: tile.width,
        height: tile.height,
        fitMode: "stretch" as const,
        x: tile.x,
        y: tile.y,
        parentNodeId: `analysis:${analysisRefId}`,
      },
      executionMode: "strict" as const,
    })),
  ]);
  await writeJsonArtifact(applyCommandPath, applyCommand);
  assertSuccessfulCommandRecord(applyCommand, `${params.frameName} apply`);

  const receipt =
    collectCreatedNodeReceipts(applyCommand).find((item) => item.analysisRefId === analysisRefId) || null;
  if (!receipt?.nodeId) {
    fail(`${params.frameName} apply did not return a root node receipt.`);
  }

  const figmaScreenshotPath = path.join(params.artifactRoot, `exact-frame-${params.viewportKey}.png`);
  const exported = await exportSingleNodeImage(params.sessionId, receipt.nodeId);
  await writePngArtifact(figmaScreenshotPath, exported.dataUrl, `${params.frameName} export`);

  const diffPath = path.join(params.artifactRoot, `exact-diff-${params.viewportKey}.json`);
  const fullDiff = measureDiff(params.browserScreenshotPath, figmaScreenshotPath);
  await writeJsonArtifact(diffPath, fullDiff);
  const hardFailed = fullDiff.acceptanceGates.some((gate) => gate.hard && !gate.passed);
  const status =
    hardFailed || (fullDiff.compositeScore ?? 0) < 0.9
      ? "fail"
      : "pass";

  return {
    viewportKey: params.viewportKey,
    nodeId: receipt.nodeId,
    frameName: params.frameName,
    tileManifestPath,
    applyCommandPath,
    figmaScreenshotPath,
    diffPath,
    fullDiff,
    status,
  };
}

async function createEditableViewportVariant(params: {
  sessionId: string;
  parentNodeId: string;
  viewportKey: string;
  frameName: string;
  snapshot: CodeToDesignRuntimeSnapshot;
  browserScreenshotPath: string;
  artifactRoot: string;
  missingCatalogFonts: Array<{ family: string; style: string | null }>;
  fontInstall: CodeToDesignFontInstallAssessment;
  fontCatalog: PluginAvailableFont[];
}) {
  const rasterizedTextNodeIds = collectRasterFallbackTextNodeIds(params.snapshot, params.missingCatalogFonts);
  const rasterizedTextNodeSet = new Set(rasterizedTextNodeIds);
  const raster = await buildTextRasterOverrides({
    snapshot: params.snapshot,
    browserScreenshotPath: params.browserScreenshotPath,
    rasterizedTextNodeIds,
    artifactRoot: params.artifactRoot,
    viewportKey: params.viewportKey,
  });
  const rasterManifestPath = path.join(params.artifactRoot, `editable-raster-${params.viewportKey}.json`);
  await writeJsonArtifact(rasterManifestPath, {
    viewportKey: params.viewportKey,
    rasterizedTextNodeIds,
    artifacts: raster.artifacts,
  });

  const plan = buildCodeToDesignPlan({
    snapshot: params.snapshot,
    frameName: params.frameName,
    parentNodeId: params.parentNodeId,
    textRasterOverrides: raster.overrides,
  });
  const batchPath = path.join(params.artifactRoot, `editable-batch-${params.viewportKey}.json`);
  const layoutTreePath = path.join(params.artifactRoot, `editable-layout-tree-${params.viewportKey}.json`);
  await writeJsonArtifact(batchPath, plan.batch);
  await writeJsonArtifact(layoutTreePath, plan.layoutTree);

  const capabilityCommands = plan.batch.commands.filter(
    (command): command is FigmaCapabilityCommand => command.type === "capability",
  );
  const applyCommand = await queueAndWaitForPluginBatch(params.sessionId, capabilityCommands);
  const applyCommandPath = path.join(params.artifactRoot, `editable-apply-${params.viewportKey}.json`);
  await writeJsonArtifact(applyCommandPath, applyCommand);
  assertSuccessfulCommandRecord(applyCommand, `${params.frameName} apply`);

  const rootReceipt =
    collectCreatedNodeReceipts(applyCommand).find((item) => item.analysisRefId === "code-to-design:page-root") || null;
  if (!rootReceipt?.nodeId) {
    fail(`${params.frameName} apply did not return a root node receipt.`);
  }

  const recoveryPath = path.join(params.artifactRoot, `editable-root-recovery-${params.viewportKey}.json`);
  const inspectPath = path.join(params.artifactRoot, `editable-inspect-${params.viewportKey}.json`);
  let rootNodeId = rootReceipt.nodeId;
  let inspectedNodes: PluginNodeInspection[];
  try {
    inspectedNodes = await inspectFrameSubtree(params.sessionId, rootNodeId, { maxDepth: 8 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("未找到节点")) {
      throw error;
    }
    const parentNodes = await inspectFrameSubtree(params.sessionId, params.parentNodeId, { maxDepth: 2 });
    const recoveredRoot =
      parentNodes.find((node) => node.analysisRefId === "code-to-design:page-root") ||
      parentNodes.find((node) => node.name === params.frameName) ||
      null;
    if (!recoveredRoot?.id) {
      fail(`${params.frameName} root node ${rootReceipt.nodeId} disappeared and could not be recovered from parent ${params.parentNodeId}.`);
    }
    rootNodeId = recoveredRoot.id;
    await writeJsonArtifact(recoveryPath, {
      viewportKey: params.viewportKey,
      originalNodeId: rootReceipt.nodeId,
      recoveredNodeId: rootNodeId,
      parentNodeId: params.parentNodeId,
      reason: message,
      parentNodes,
    });
    inspectedNodes = await inspectFrameSubtree(params.sessionId, rootNodeId, { maxDepth: 8 });
  }
  await writeJsonArtifact(inspectPath, inspectedNodes);

  const figmaScreenshotPath = path.join(params.artifactRoot, `editable-frame-${params.viewportKey}.png`);
  const exported = await exportSingleNodeImage(params.sessionId, rootNodeId);
  await writePngArtifact(figmaScreenshotPath, exported.dataUrl, `${params.frameName} export`);

  const diffPath = path.join(params.artifactRoot, `editable-diff-${params.viewportKey}.json`);
  const fullDiff = measureDiff(params.browserScreenshotPath, figmaScreenshotPath);
  await writeJsonArtifact(diffPath, fullDiff);

  const qualitySnapshot = buildRasterFallbackQualitySnapshot(params.snapshot, rasterizedTextNodeSet);
  const filteredFontInstall = filterFontInstallAssessmentForRasterizedText({
    fontInstall: params.fontInstall,
    snapshot: params.snapshot,
    rasterizedTextNodeIds: rasterizedTextNodeSet,
  });
  const visualDiffInput = {
    compositeScore: fullDiff.compositeScore,
    artifactPaths: [inspectPath, figmaScreenshotPath, diffPath],
    notes: [summarizeDiffMetrics(params.viewportKey, fullDiff)],
    acceptanceGates: fullDiff.acceptanceGates,
    hotspots: fullDiff.hotspots,
  };
  const provisionalQuality = buildCodeToDesignQualityReport({
    snapshot: qualitySnapshot,
    layoutTree: plan.layoutTree,
    requiredContainerNames: plan.qualityReport.structure.requiredContainerNames,
    phase: "live_acceptance",
    fontInstall: filteredFontInstall,
    fontCatalog: params.fontCatalog,
    runtimeResults: applyCommand.results,
    inspectedNodes,
    visualDiff: visualDiffInput,
  });
  const responsiveProbe = {
    viewportKey: params.viewportKey,
    status:
      provisionalQuality.figmaTree.status === "pass" && provisionalQuality.visualDiff.status === "pass"
        ? "pass"
        : "fail",
    score: Math.round(((provisionalQuality.figmaTree.score + (provisionalQuality.visualDiff.score ?? 0)) / 2) * 10) / 10,
    figmaTreeStatus: provisionalQuality.figmaTree.status,
    visualDiffStatus: provisionalQuality.visualDiff.status,
    compositeScore: fullDiff.compositeScore,
    artifactPaths: [inspectPath, figmaScreenshotPath, diffPath],
    notes: [
      `figmaTree=${provisionalQuality.figmaTree.status}`,
      `visualDiff=${provisionalQuality.visualDiff.status}`,
      summarizeDiffMetrics(params.viewportKey, fullDiff),
    ],
  };
  const quality = buildCodeToDesignQualityReport({
    snapshot: qualitySnapshot,
    layoutTree: plan.layoutTree,
    requiredContainerNames: plan.qualityReport.structure.requiredContainerNames,
    phase: "live_acceptance",
    fontInstall: filteredFontInstall,
    fontCatalog: params.fontCatalog,
    runtimeResults: applyCommand.results,
    inspectedNodes,
    visualDiff: visualDiffInput,
    responsive: {
      requiredViewportKeys: [params.viewportKey],
      probes: [responsiveProbe],
    },
  });
  const qualityPath = path.join(params.artifactRoot, `editable-quality-${params.viewportKey}.json`);
  await writeJsonArtifact(qualityPath, quality);

  return {
    viewportKey: params.viewportKey,
    nodeId: rootNodeId,
    frameName: params.frameName,
    rasterizedTextNodeIds,
    rasterManifestPath,
    batchPath,
    layoutTreePath,
    applyCommandPath,
    inspectPath,
    figmaScreenshotPath,
    diffPath,
    qualityPath,
    fullDiff,
    quality,
  };
}

async function runFontRasterFallbackDelivery(params: {
  sessionId: string;
  parentNodeId: string;
  artifactRoot: string;
  baseFrameName: string;
  captureArtifacts: Array<{
    probe: ResponsiveProbe;
    browserScreenshotPath: string;
    snapshot: CodeToDesignRuntimeSnapshot;
  }>;
  missingCatalogFonts: Array<{ family: string; style: string | null }>;
  fontInstall: CodeToDesignFontInstallAssessment;
  fontManifest: Awaited<ReturnType<typeof loadCodeToDesignFontManifest>>["manifest"] | null;
  fontCatalog: PluginAvailableFont[];
}) {
  const deliveryRoot = await createVerticalDeliveryFrame({
    sessionId: params.sessionId,
    parentNodeId: params.parentNodeId,
    name: `${params.baseFrameName} Delivery`,
    analysisRefId: "code-to-design:fallback-delivery-root",
    commandPath: path.join(params.artifactRoot, "fallback-delivery-root.json"),
  });
  const editableRoot = await createVerticalDeliveryFrame({
    sessionId: params.sessionId,
    parentNodeId: deliveryRoot.nodeId,
    name: "Editable Variants",
    analysisRefId: "code-to-design:fallback-editable-root",
    commandPath: path.join(params.artifactRoot, "fallback-editable-root.json"),
  });

  const editableVariants = [];
  for (const captureArtifact of params.captureArtifacts) {
    const normalizedSnapshot = normalizeCodeToDesignSnapshotFonts(
      captureArtifact.snapshot,
      params.fontManifest || null,
    ).snapshot;
    editableVariants.push(
      await createEditableViewportVariant({
        sessionId: params.sessionId,
        parentNodeId: editableRoot.nodeId,
        viewportKey: captureArtifact.probe.viewportKey,
        frameName: `${params.baseFrameName} / Editable / ${titleCaseViewportKey(captureArtifact.probe.viewportKey)}`,
        snapshot: normalizedSnapshot,
        browserScreenshotPath: captureArtifact.browserScreenshotPath,
        artifactRoot: params.artifactRoot,
        missingCatalogFonts: params.missingCatalogFonts,
        fontInstall: params.fontInstall,
        fontCatalog: params.fontCatalog,
      }),
    );
  }

  const overallStatus = editableVariants.every((variant) => variant.quality.overallStatus === "pass") ? "pass" : "fail";
  const summaryPath = path.join(params.artifactRoot, "fallback-delivery-summary.json");
  await writeJsonArtifact(summaryPath, {
    kind: "code_to_design_fallback_delivery",
    version: "v1",
    deliveryMode: "editable_with_rasterized_text",
    overallStatus,
    deliveryRootNodeId: deliveryRoot.nodeId,
    editableRootNodeId: editableRoot.nodeId,
    missingCatalogFonts: params.missingCatalogFonts,
    editableVariants: editableVariants.map((variant) => ({
      viewportKey: variant.viewportKey,
      nodeId: variant.nodeId,
      frameName: variant.frameName,
      overallStatus: variant.quality.overallStatus,
      compositeScore: variant.fullDiff.compositeScore,
      rasterizedTextNodeIds: variant.rasterizedTextNodeIds,
      diffPath: variant.diffPath,
      qualityPath: variant.qualityPath,
      figmaScreenshotPath: variant.figmaScreenshotPath,
    })),
  });

  return {
    overallStatus,
    summaryPath,
    deliveryRootNodeId: deliveryRoot.nodeId,
    editableVariants,
  };
}

function usage() {
  return [
    "Usage:",
    "  npm run code-to-design:acceptance -- --project ../AItest --dist ../AItest/dist --entry src/App.tsx --session <SESSION_ID> --parent-node-id 0:1",
    "  npm run code-to-design:acceptance -- --project ../AItest --dist ../AItest/dist --entry src/App.tsx --parent-node-id 0:1 --replace-node-id <FRAME_NODE_ID>",
  ].join("\n");
}

export async function runCodeToDesignAcceptanceCli(argv: string[]) {
  if (hasFlag(argv, "--help") || hasFlag(argv, "-h")) {
    return {
      exitCode: 0,
      output: usage(),
      qualityReport: null,
    };
  }

  const projectRoot = readFlag(argv, "--project");
  const distRoot = readFlag(argv, "--dist");
  const entryPaths = readFlags(argv, "--entry");
  if (!projectRoot && !distRoot) {
    fail(`--project or --dist is required\n\n${usage()}`);
  }
  const snapshot = await requestJson<PluginBridgeSnapshot>("/api/plugin-bridge");
  const session = pickSession(snapshot.sessions.filter((item) => item.status === "online"), readFlag(argv, "--session"));
  await requireOnlineSession(session.id);

  const parentNodeId =
    readFlag(argv, "--parent-node-id") ||
    session.selection[0]?.parentNodeId ||
    null;
  if (!parentNodeId) {
    fail(`--parent-node-id is required when the current selection has no parent node\n\n${usage()}`);
  }

  const timestamp = nowTimestamp();
  const artifactRoot =
    readFlag(argv, "--artifacts-dir") ||
    path.join(repoRoot, "reports", "acceptance", "artifacts", timestamp, "code-to-design");
  await mkdir(artifactRoot, { recursive: true });
  const progressPath = path.join(artifactRoot, "progress.log");
  async function recordPhase(phase: string, detail?: string) {
    const line = `[${new Date().toISOString()}] ${phase}${detail ? ` | ${detail}` : ""}\n`;
    await writeFile(progressPath, line, { encoding: "utf8", flag: "a" });
  }

  const snapshotPath = path.join(artifactRoot, "capture-snapshot.json");
  const batchPath = path.join(artifactRoot, "plan-batch.json");
  const preflightQualityPath = path.join(artifactRoot, "quality-preflight.json");
  const layoutTreePath = path.join(artifactRoot, "layout-tree.json");
  const fontSyncPath = path.join(artifactRoot, "font-sync.json");
  const fontCatalogPath = path.join(artifactRoot, "font-catalog.json");
  const fontDiagnosticsPath = path.join(artifactRoot, "font-diagnostics.json");
  const fontPreflightPath = path.join(artifactRoot, "font-preflight.json");
  const fontNormalizationPath = path.join(artifactRoot, "font-normalization.json");
  const runtimeProbePath = path.join(artifactRoot, "runtime-probe.json");
  const replaceCommandPath = path.join(artifactRoot, "replace-command.json");
  const applyCommandPath = path.join(artifactRoot, "apply-command.json");
  const finalQualityPath = path.join(artifactRoot, "quality-live.json");

  const viewportHeight = Number(readFlag(argv, "--viewport-height") || 2200);
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    fail("--viewport-height must be a positive number");
  }
  const route = readFlag(argv, "--route");
  const frameName = readFlag(argv, "--frame-name") || undefined;
  const imageStrategy = readFlag(argv, "--image-strategy") || undefined;
  const allowFontRasterFallback = hasFlag(argv, "--allow-font-raster-fallback");
  if (allowFontRasterFallback) {
    return {
      exitCode: 1,
      output: [
        "Code-to-Design Acceptance",
        `session: ${session.id}`,
        `parentNodeId: ${parentNodeId}`,
        "overallStatus: fail",
        "failureStage: invalid-configuration",
        `artifacts: ${artifactRoot}`,
        "note: --allow-font-raster-fallback has been disabled.",
        "note: only source image positions may produce image nodes; all non-image content must remain editable.",
      ].join("\n"),
      qualityReport: null,
    };
  }

  const captureArtifacts: Array<{
    probe: ResponsiveProbe;
    snapshotPath: string;
    browserScreenshotPath: string;
    snapshot: CodeToDesignRuntimeSnapshot;
  }> = [];
  for (const probe of RESPONSIVE_PROBES) {
    const probeSnapshotPath = path.join(artifactRoot, `capture-${probe.viewportKey}.json`);
    const probeBrowserScreenshotPath = path.join(artifactRoot, `browser-${probe.viewportKey}.png`);
    await recordPhase("capture:start", `${probe.viewportKey} | ${probe.width}x${viewportHeight}`);
    const captureArgs = [
      "node",
      "code-to-design-capture",
      ...(projectRoot ? ["--project", projectRoot] : []),
      ...(distRoot ? ["--dist", distRoot] : []),
      ...entryPaths.flatMap((entryPath) => ["--entry", entryPath]),
      ...(route ? ["--route", route] : []),
      "--viewport-key",
      probe.viewportKey,
      "--viewport-width",
      String(probe.width),
      "--viewport-height",
      String(viewportHeight),
      "--out",
      probeSnapshotPath,
      "--screenshot-out",
      probeBrowserScreenshotPath,
    ];
    const captureResult = await runCodeToDesignCaptureCli(captureArgs);
    if (!captureResult.snapshot) {
      fail(`code-to-design capture did not return a snapshot for ${probe.viewportKey}`);
    }
    captureArtifacts.push({
      probe,
      snapshotPath: probeSnapshotPath,
      browserScreenshotPath: probeBrowserScreenshotPath,
      snapshot: captureResult.snapshot,
    });
    await recordPhase("capture:done", `${probe.viewportKey} | ${probeSnapshotPath}`);
  }

  const captureResult = {
    snapshot: combineResponsiveCodeToDesignSnapshots({
      primaryViewportKey: "desktop",
      snapshots: captureArtifacts.map((artifact) => artifact.snapshot),
    }),
  };
  await writeJsonArtifact(snapshotPath, captureResult.snapshot);

  await recordPhase("font-sync:start");
  const fontSync = await syncCodeToDesignFontBundle({
    snapshot: captureResult.snapshot,
    bundleRoot: readFlag(argv, "--font-bundle-root"),
    projectRoot,
    distRoot,
  });
  await writeJsonArtifact(fontSyncPath, fontSync);
  await recordPhase("font-sync:done", `${fontSync.status} | ${fontSyncPath}`);

  const fontBundleRoot = resolveCodeToDesignFontBundleRoot(readFlag(argv, "--font-bundle-root"));
  const fontManifest = await loadCodeToDesignFontManifest(fontBundleRoot).catch(() => null);
  const normalizedFonts = normalizeCodeToDesignSnapshotFonts(
    captureResult.snapshot,
    fontManifest?.manifest || null,
  );
  await writeJsonArtifact(fontNormalizationPath, {
    notes: normalizedFonts.notes,
  });

  await recordPhase("font-preflight:start");
  const fontPreflight = await buildCodeToDesignFontInstallAssessment({
    snapshot: normalizedFonts.snapshot,
    bundleRoot: readFlag(argv, "--font-bundle-root"),
    projectRoot,
    distRoot,
    install: !hasFlag(argv, "--skip-font-install"),
    targetDir: readFlag(argv, "--font-target-dir"),
  });
  await writeJsonArtifact(fontPreflightPath, fontPreflight);
  await recordPhase("font-preflight:done", `${fontPreflight.status} | ${fontPreflightPath}`);
  if (fontPreflight.status !== "pass") {
    return {
      exitCode: 1,
      output: [
        "Code-to-Design Acceptance",
        `session: ${session.id}`,
        `parentNodeId: ${parentNodeId}`,
        "overallStatus: fail",
        "failureStage: font-preflight",
        `artifacts: ${artifactRoot}`,
        `fontSync: ${fontSyncPath}`,
        `fontPreflight: ${fontPreflightPath}`,
        `fontNormalization: ${fontNormalizationPath}`,
        ...fontSync.notes.map((note) => `note: ${note}`),
        ...normalizedFonts.notes.map((note) => `note: ${note}`),
        ...fontPreflight.notes.map((note) => `note: ${note}`),
      ].join("\n"),
      qualityReport: null,
    };
  }

  await recordPhase("font-catalog:start");
  const runtimeFontCatalog = await inspectRuntimeFontCatalog(session.id);
  await writeJsonArtifact(fontCatalogPath, runtimeFontCatalog);
  await recordPhase("font-catalog:done", `${runtimeFontCatalog.fontCatalog.length} entries | ${fontCatalogPath}`);
  const missingCatalogFonts = findMissingCatalogFonts(
    fontPreflight.resolvedFonts.map((font) => ({
      family: font.figmaFamily,
      style: font.figmaStyle,
    })),
    runtimeFontCatalog.fontCatalog,
  );
  const runtimeFontLoadProbe = await probeRuntimeFontLoad(session.id, missingCatalogFonts);
  const effectiveFontCatalog = mergeFontCatalog(
    runtimeFontCatalog.fontCatalog,
    runtimeFontLoadProbe.fontLoadResults,
  );
  const fontDiagnostics = buildFontEnvironmentDiagnostics({
    sessionId: session.id,
    fontManifestPath: fontManifest?.manifestPath || null,
    fontPreflight,
    fontCatalog: runtimeFontCatalog.fontCatalog,
    directLoadResults: runtimeFontLoadProbe.fontLoadResults,
  });
  await writeJsonArtifact(fontDiagnosticsPath, fontDiagnostics);
  const unresolvedFonts = fontDiagnostics.verdict.missingFonts;
  if (unresolvedFonts.length) {
    return {
      exitCode: 1,
      output: [
        "Code-to-Design Acceptance",
        `session: ${session.id}`,
        `parentNodeId: ${parentNodeId}`,
        "overallStatus: fail",
        "failureStage: font-environment",
        `artifacts: ${artifactRoot}`,
        `fontCatalog: ${fontCatalogPath}`,
        `fontDiagnostics: ${fontDiagnosticsPath}`,
        `fontPreflight: ${fontPreflightPath}`,
        `fontNormalization: ${fontNormalizationPath}`,
        ...(fontPreflight.installedFiles.length || fontPreflight.skippedFiles.length
          ? ["note: exact fonts were installed during this run, but the active Figma session still does not expose them; reload the plugin or restart Figma before rerunning acceptance."]
          : []),
        ...normalizedFonts.notes.map((note) => `note: ${note}`),
        ...fontDiagnostics.directLoadResults
          .filter((result) => !result.ok)
          .map((result) => `note: direct font load failed: ${result.family}/${result.style} (${result.message})`),
        ...unresolvedFonts.map((font) => `note: missing exact font in active session: ${font.family}/${font.style || "Regular"}`),
      ].join("\n"),
      qualityReport: null,
    };
  }

  await recordPhase("plan:start");
  const plan = buildCodeToDesignPlan({
    snapshot: normalizedFonts.snapshot,
    frameName,
    parentNodeId,
    ...(imageStrategy === "frame_raster" ? { imageStrategy: "frame_raster" as const } : {}),
  });
  plan.qualityReport = buildCodeToDesignQualityReport({
    snapshot: normalizedFonts.snapshot,
    layoutTree: plan.layoutTree,
    requiredContainerNames: plan.qualityReport.structure.requiredContainerNames,
    phase: "preflight",
    fontInstall: fontPreflight,
  });
  await writeJsonArtifact(batchPath, plan.batch);
  await writeJsonArtifact(preflightQualityPath, plan.qualityReport);
  await writeJsonArtifact(layoutTreePath, plan.layoutTree);
  await recordPhase("plan:done", batchPath);

  await recordPhase("runtime-probe:start");
  const runtimeProbe = await runRuntimeReceiptProbe({
    sessionId: session.id,
    parentNodeId,
  });
  await writeJsonArtifact(runtimeProbePath, runtimeProbe);
  await recordPhase("runtime-probe:done", runtimeProbe.status);
  if (runtimeProbe.status !== "pass") {
    return {
      exitCode: 1,
      output: [
        "Code-to-Design Acceptance",
        `session: ${session.id}`,
        `parentNodeId: ${parentNodeId}`,
        "overallStatus: fail",
        "failureStage: runtime-probe",
        `artifacts: ${artifactRoot}`,
        `runtimeProbe: ${runtimeProbePath}`,
        ...runtimeProbe.notes.map((note) => `note: ${note}`),
      ].join("\n"),
      qualityReport: null,
    };
  }

  await recordPhase("replace:start", readFlag(argv, "--replace-node-id") || "skip");
  await maybeReplaceExistingFrame({
    replaceNodeId: readFlag(argv, "--replace-node-id"),
    sessionId: session.id,
    commandPath: replaceCommandPath,
  });
  await recordPhase("replace:done", replaceCommandPath);

  await recordPhase("apply:start", String(plan.batch.commands.length));
  const capabilityCommands = plan.batch.commands.filter(
    (command): command is FigmaCapabilityCommand => command.type === "capability",
  );
  const applyCommand = await queueAndWaitForPluginBatch(session.id, capabilityCommands);
  await writeJsonArtifact(applyCommandPath, applyCommand);
  await recordPhase("apply:done", applyCommandPath);

  const rootReceipt = applyCommand.results
    .flatMap((result) => result.createdNodeReceipts || [])
    .find((receipt) => receipt.analysisRefId === "code-to-design:page-root") || null;

  let inspectedNodes: PluginNodeInspection[] = [];
  let visualDiffInput:
    | {
        score?: number;
        compositeScore?: number;
        artifactPaths?: string[];
        notes?: string[];
        acceptanceGates?: DiffMetrics["acceptanceGates"];
        hotspots?: DiffMetrics["hotspots"];
      }
    | undefined;
  const responsiveProbeSummaries: Array<{
    viewportKey: string;
    status: "pass" | "fail";
    score: number;
    figmaTreeStatus: "pass" | "fail" | "pending";
    visualDiffStatus: "pass" | "fail" | "pending";
    compositeScore: number | null;
    artifactPaths: string[];
    notes: string[];
  }> = [];

  if (rootReceipt?.nodeId) {
    const probeResults: ResponsiveProbeResult[] = [];
    const aggregatedArtifactPaths: string[] = [];
    const aggregatedGates: DiffMetrics["acceptanceGates"] = [];
    const aggregatedHotspots: DiffMetrics["hotspots"] = [];
    let desktopProbeQuality: ReturnType<typeof buildCodeToDesignQualityReport> | null = null;

    for (const captureArtifact of captureArtifacts) {
      const variant = getResponsiveVariantSnapshot(normalizedFonts.snapshot, captureArtifact.probe.viewportKey);
      if (!variant) {
        continue;
      }

      const probeLayoutTree = materializeLayoutTreeForViewport(plan.layoutTree, captureArtifact.probe.viewportKey);
      await recordPhase("probe:resize", `${captureArtifact.probe.viewportKey} | ${variant.page.scrollWidth}x${variant.page.scrollHeight}`);
      await resizeFrameNode(session.id, rootReceipt.nodeId, {
        width: variant.page.scrollWidth || variant.viewport.width,
        height: variant.page.scrollHeight || variant.viewport.height,
      });

      const probeInspectPath = path.join(artifactRoot, `figma-inspect-${captureArtifact.probe.viewportKey}.json`);
      await recordPhase("inspect:start", `${captureArtifact.probe.viewportKey} | ${rootReceipt.nodeId}`);
      const probeInspectedNodes = await inspectFrameSubtree(
        session.id,
        rootReceipt.nodeId,
        { maxDepth: Number.parseInt(readFlag(argv, "--max-inspect-depth") || "8", 10) },
      );
      await writeJsonArtifact(probeInspectPath, probeInspectedNodes);
      await recordPhase("inspect:done", probeInspectPath);

      const probeFigmaScreenshotPath = path.join(artifactRoot, `figma-frame-${captureArtifact.probe.viewportKey}.png`);
      await recordPhase("export:start", `${captureArtifact.probe.viewportKey} | ${rootReceipt.nodeId}`);
      const exported = await exportSingleNodeImage(session.id, rootReceipt.nodeId);
      await writePngArtifact(probeFigmaScreenshotPath, exported.dataUrl, "Figma frame export");
      await recordPhase("export:done", probeFigmaScreenshotPath);

      const probeFullDiffPath = path.join(artifactRoot, `visual-diff-${captureArtifact.probe.viewportKey}.json`);
      await recordPhase("diff:start", captureArtifact.probe.viewportKey);
      const fullDiff = measureDiff(captureArtifact.browserScreenshotPath, probeFigmaScreenshotPath);
      await writeJsonArtifact(probeFullDiffPath, fullDiff);

      const sectionDiffs: SectionDiffResult[] = [];
      for (const section of [
        { id: "opening-spread", label: "Opening Spread" },
        { id: "supporting-block", label: "Supporting Block" },
        { id: "look-rail", label: "Look Rail" },
      ]) {
        const sectionNode = findLayoutNodeById(plan.layoutTree, section.id);
        if (!sectionNode) {
          continue;
        }
        const metrics = measureDiff(
          captureArtifact.browserScreenshotPath,
          probeFigmaScreenshotPath,
          normalizeCropBoundsForViewport(plan.layoutTree, sectionNode, captureArtifact.probe.viewportKey),
        );
        const artifactPath = path.join(
          artifactRoot,
          `visual-diff-${captureArtifact.probe.viewportKey}-${section.id}.json`,
        );
        await writeJsonArtifact(artifactPath, metrics);
        sectionDiffs.push({
          id: section.id,
          label: section.label,
          metrics,
          artifactPath,
        });
      }

      const probeVisualDiffInput = {
        score: Math.round((1 - fullDiff.compositeScore) * 1000) / 10,
        compositeScore: fullDiff.compositeScore,
        artifactPaths: [
          captureArtifact.browserScreenshotPath,
          probeFigmaScreenshotPath,
          probeFullDiffPath,
          ...sectionDiffs.map((section) => section.artifactPath),
        ],
        acceptanceGates: [
          ...fullDiff.acceptanceGates,
          ...sectionDiffs.flatMap((section) =>
            section.metrics.acceptanceGates.map((gate) => ({
              ...gate,
              id: `${section.id}:${gate.id}`,
              label: `${section.label} / ${gate.label}`,
            })),
          ),
        ],
        hotspots: fullDiff.hotspots,
        notes: [
          summarizeDiffMetrics("full-page", fullDiff),
          ...sectionDiffs.map((section) => summarizeDiffMetrics(section.label, section.metrics)),
        ],
      };

      const probeQuality = buildCodeToDesignQualityReport({
        snapshot: normalizedFonts.snapshot,
        layoutTree: probeLayoutTree,
        requiredContainerNames: plan.qualityReport.structure.requiredContainerNames,
        phase: "live_acceptance",
        fontInstall: fontPreflight,
        runtimeResults: applyCommand.results,
        inspectedNodes: probeInspectedNodes,
        visualDiff: probeVisualDiffInput,
      });

      if (captureArtifact.probe.viewportKey === "desktop") {
        inspectedNodes = probeInspectedNodes;
        desktopProbeQuality = probeQuality;
      }

      aggregatedArtifactPaths.push(...probeVisualDiffInput.artifactPaths);
      aggregatedGates.push(
        ...probeVisualDiffInput.acceptanceGates.map((gate) => ({
          ...gate,
          id: `${captureArtifact.probe.viewportKey}:${gate.id}`,
          label: `${captureArtifact.probe.viewportKey} / ${gate.label}`,
        })),
      );
      aggregatedHotspots.push(
        ...fullDiff.hotspots.map((hotspot) => ({
          ...hotspot,
          id: `${captureArtifact.probe.viewportKey}:${hotspot.id}`,
        })),
      );
      probeResults.push({
        viewportKey: captureArtifact.probe.viewportKey,
        browserScreenshotPath: captureArtifact.browserScreenshotPath,
        snapshotPath: captureArtifact.snapshotPath,
        snapshot: captureArtifact.snapshot,
        figmaScreenshotPath: probeFigmaScreenshotPath,
        inspectPath: probeInspectPath,
        fullDiffPath: probeFullDiffPath,
        fullDiff,
        sectionDiffs,
        quality: probeQuality,
      });
      responsiveProbeSummaries.push(
        summarizeResponsiveProbe(captureArtifact.probe.viewportKey, probeQuality, fullDiff),
      );
      await recordPhase("diff:done", `${captureArtifact.probe.viewportKey} | ${probeFullDiffPath}`);
    }

    const desktopVariant = getResponsiveVariantSnapshot(normalizedFonts.snapshot, "desktop");
    if (desktopVariant) {
      await resizeFrameNode(session.id, rootReceipt.nodeId, {
        width: desktopVariant.page.scrollWidth || desktopVariant.viewport.width,
        height: desktopVariant.page.scrollHeight || desktopVariant.viewport.height,
      });
    }

    if (desktopProbeQuality) {
      visualDiffInput = {
        score:
          responsiveProbeSummaries.length > 0
            ? Math.round(
                (responsiveProbeSummaries.reduce((total, probe) => total + (probe.score ?? 0), 0) /
                  responsiveProbeSummaries.length) *
                  10,
              ) / 10
            : desktopProbeQuality.visualDiff.score ?? undefined,
        compositeScore:
          probeResults.length > 0
            ? probeResults.reduce((total, probe) => total + probe.fullDiff.compositeScore, 0) / probeResults.length
            : desktopProbeQuality.visualDiff.compositeScore ?? undefined,
        artifactPaths: aggregatedArtifactPaths,
        acceptanceGates: aggregatedGates,
        hotspots: aggregatedHotspots,
        notes: probeResults.flatMap((probe) => [
          `${probe.viewportKey}: ${summarizeDiffMetrics("full-page", probe.fullDiff)}`,
          ...probe.sectionDiffs.map((section) =>
            `${probe.viewportKey}: ${summarizeDiffMetrics(section.label, section.metrics)}`,
          ),
        ]),
      };
    }
  }

  await recordPhase("quality:start");
  const finalQuality = buildCodeToDesignQualityReport({
    snapshot: normalizedFonts.snapshot,
    layoutTree: plan.layoutTree,
    requiredContainerNames: plan.qualityReport.structure.requiredContainerNames,
    phase: "live_acceptance",
    fontInstall: fontPreflight,
    fontCatalog: effectiveFontCatalog,
    runtimeResults: applyCommand.results,
    inspectedNodes,
    visualDiff: visualDiffInput,
    responsive: {
      requiredViewportKeys: RESPONSIVE_PROBES.map((probe) => probe.viewportKey),
      probes: responsiveProbeSummaries,
    },
  });
  await writeJsonArtifact(finalQualityPath, finalQuality);
  await recordPhase("quality:done", `${finalQuality.overallStatus} | ${finalQualityPath}`);

  return {
    exitCode: finalQuality.overallStatus === "pass" ? 0 : 1,
    output: [
      "Code-to-Design Acceptance",
      `session: ${session.id}`,
      `parentNodeId: ${parentNodeId}`,
      `frameNodeId: ${rootReceipt?.nodeId || "missing"}`,
      `overallStatus: ${finalQuality.overallStatus}`,
      `structure: ${finalQuality.structure.status}`,
      `naming: ${finalQuality.naming.status}`,
      `figmaTree: ${finalQuality.figmaTree.status}`,
      `fontInstall: ${finalQuality.fontInstall.status}`,
      `fontEnvironment: ${finalQuality.fontEnvironment.status}`,
      `fontAlignment: ${finalQuality.fontAlignment.status}`,
      `visualDiff: ${finalQuality.visualDiff.status}`,
      `responsive: ${finalQuality.responsive.status}`,
      `artifacts: ${artifactRoot}`,
      `qualityReport: ${finalQualityPath}`,
    ].join("\n"),
    qualityReport: finalQuality,
  };
}

export async function main(argv = process.argv) {
  try {
    const result = await runCodeToDesignAcceptanceCli(argv);
    console.log(result.output);
    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "code-to-design acceptance failed");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
