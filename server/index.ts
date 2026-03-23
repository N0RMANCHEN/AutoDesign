import { createServer } from "node:http";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildContextPack } from "../shared/context-pack.js";
import type {
  InspectFrameRequestPayload,
  InspectFrameResponsePayload,
  PluginBridgeCommandRecord,
  PluginImageArtifact,
  PluginCommandResultPayload,
  PluginBridgeSession,
  PluginNodeInspection,
  PluginNodeSummary,
  PluginSessionRegistrationPayload,
  QueuePluginCommandPayload,
} from "../shared/plugin-bridge.js";
import type {
  ApproveReconstructionPlanPayload,
  CreateReconstructionJobPayload,
  ReconstructionBounds,
  ReconstructionContextPack,
  ReconstructionFontMatch,
  ReconstructionJob,
  ReconstructionLoopStopReason,
  ReconstructionRegion,
  ReconstructionStructureReport,
  ReconstructionTextCandidate,
  SubmitReconstructionAnalysisPayload,
  ReviewReconstructionAssetPayload,
  ReviewReconstructionFontPayload,
} from "../shared/reconstruction.js";
import { RECONSTRUCTION_ACTIONABLE_CONFIDENCE } from "../shared/reconstruction.js";
import type { FigmaCapabilityCommand, FigmaPluginCommandBatch } from "../shared/plugin-contract.js";
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
  getPluginCommandRecord,
  getPluginBridgeSnapshot,
  heartbeatPluginSession,
  queuePluginCommand,
  registerPluginSession,
} from "./plugin-bridge-store.js";
import {
  approveReconstructionPlan,
  clearReconstructionAppliedState,
  createReconstructionJob,
  completeReconstructionAnalysis,
  failReconstructionJob,
  getReconstructionJob,
  listReconstructionJobs,
  markReconstructionApplied,
  markReconstructionLoopStatus,
  markReconstructionMeasured,
  markReconstructionRefined,
  markReconstructionRendered,
  prepareHybridReconstruction,
  prepareRasterReconstruction,
  prepareVectorReconstruction,
  reviewReconstructionAssetChoice,
  reviewReconstructionFontChoice,
} from "./reconstruction-store.js";
import {
  buildNormalizedReconstructionAnalysis,
  buildReconstructionContextPack,
  runPreviewOnlyReconstructionAnalysis,
} from "./reconstruction-analysis.js";
import {
  buildRefineSuggestions,
  createRenderedPreview,
  measurePreviewDiff,
} from "./reconstruction-evaluation.js";
import { remapHybridReferenceRaster } from "./reconstruction-raster.js";
import { readProject, resetProject, writeProject } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.resolve(__dirname, "..");
const distDirectory = path.join(rootDirectory, "dist");
const port = Number(process.env.PORT ?? 3001);
const pluginCommandWaitTimeoutMs = 30_000;
const pluginCommandPollIntervalMs = 300;

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

function findSessionById(sessions: PluginBridgeSession[], sessionId: string) {
  return sessions.find((session) => session.id === sessionId) || null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function collectCommandWarnings(command: PluginBridgeCommandRecord) {
  return uniqueStrings(command.results.flatMap((result) => result.warnings || []));
}

function collectChangedNodeIds(command: PluginBridgeCommandRecord) {
  return uniqueStrings(command.results.flatMap((result) => result.changedNodeIds || []));
}

function collectExportedImages(command: PluginBridgeCommandRecord) {
  return command.results.flatMap((result) => result.exportedImages || []) as PluginImageArtifact[];
}

function collectInspectedNodes(command: PluginBridgeCommandRecord) {
  return command.results.flatMap((result) => result.inspectedNodes || []) as PluginNodeInspection[];
}

function isOnlineSession(session: PluginBridgeSession | null) {
  return Boolean(session && session.status === "online");
}

function supportsExplicitNodeTargeting(session: PluginBridgeSession | null) {
  return Boolean(session?.runtimeFeatures?.supportsExplicitNodeTargeting);
}

async function requireOnlineSession(sessionId: string) {
  const snapshot = await getPluginBridgeSnapshot();
  const session = findSessionById(snapshot.sessions, sessionId);
  if (!session) {
    throw new Error("Plugin session not found");
  }
  if (!isOnlineSession(session)) {
    throw new Error(`Plugin session ${sessionId} is not online.`);
  }
  return session;
}

async function requireLoopCompatibleSession(sessionId: string) {
  const session = await requireOnlineSession(sessionId);
  if (!supportsExplicitNodeTargeting(session)) {
    throw new Error(
      "当前在线 AutoDesign 插件会话未声明 supportsExplicitNodeTargeting，server 已阻止 auto-refine loop 继续执行。请重新导入并重新运行最新插件。",
    );
  }
  return session;
}

async function waitForPluginCommand(commandId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= pluginCommandWaitTimeoutMs) {
    const command = await getPluginCommandRecord(commandId);
    if (!command) {
      throw new Error(`Plugin command ${commandId} not found.`);
    }
    if (command.status === "succeeded" || command.status === "failed") {
      return command;
    }
    await sleep(pluginCommandPollIntervalMs);
  }
  throw new Error(`Timed out waiting for plugin command ${commandId}.`);
}

async function queueAndWaitForPluginBatch(
  targetSessionId: string,
  commands: FigmaCapabilityCommand[],
) {
  if (!commands.length) {
    throw new Error("No reconstruction commands to execute.");
  }

  await requireOnlineSession(targetSessionId);

  const batch: FigmaPluginCommandBatch = {
    source: "codex",
    issuedAt: nowIso(),
    commands: commands.map((command) => ({
      ...command,
      executionMode: "strict",
    })),
  };

  const queued = await queuePluginCommand({
    targetSessionId,
    source: "codex",
    payload: batch,
  });

  return waitForPluginCommand(queued.id);
}

function isRasterExactJob(job: ReconstructionJob) {
  return job.input.strategy === "raster-exact";
}

function isVectorReconstructionJob(job: ReconstructionJob) {
  return job.input.strategy === "vector-reconstruction";
}

function isHybridReconstructionJob(job: ReconstructionJob) {
  return job.input.strategy === "hybrid-reconstruction";
}

async function exportSingleNodeImage(
  targetSessionId: string,
  nodeId: string,
  options?: {
    preferOriginalBytes?: boolean;
    constraint?: { type: "WIDTH" | "HEIGHT" | "SCALE"; value: number };
  },
) {
  const command = await queueAndWaitForPluginBatch(targetSessionId, [
    {
      type: "capability",
      capabilityId: "assets.export-node-image",
      nodeIds: [nodeId],
      payload: {
        preferOriginalBytes: options?.preferOriginalBytes,
        ...(options?.constraint ? { constraint: options.constraint } : {}),
      },
      executionMode: "strict",
    },
  ]);

  assertSuccessfulCommandRecord(command, "Node image export");
  const artifact = collectExportedImages(command).find((item) => item.nodeId === nodeId) || null;
  if (!artifact) {
    throw new Error(`Node image export completed without artifact for node ${nodeId}.`);
  }
  return artifact;
}

async function inspectFrameSubtree(
  targetSessionId: string,
  frameNodeId: string,
  options?: { maxDepth?: number },
) {
  const command = await queueAndWaitForPluginBatch(targetSessionId, [
    {
      type: "capability",
      capabilityId: "nodes.inspect-subtree",
      payload: {
        nodeId: frameNodeId,
        ...(Number.isFinite(options?.maxDepth) ? { maxDepth: options?.maxDepth } : {}),
      },
      executionMode: "strict",
    },
  ]);

  assertSuccessfulCommandRecord(command, "Frame inspect");
  return collectInspectedNodes(command);
}

function isReconstructionGeneratedInspectionNode(node: PluginNodeInspection) {
  return (
    node.generatedBy === "reconstruction" ||
    node.name.startsWith("AD Vector/") ||
    node.name.startsWith("AD Hybrid/") ||
    node.name.startsWith("AD Rebuild/")
  );
}

async function ensureRasterReference(job: ReconstructionJob) {
  if (job.referenceRaster) {
    return job.referenceRaster;
  }

  const referenceRaster = await exportSingleNodeImage(job.input.targetSessionId, job.referenceNode.id, {
    preferOriginalBytes: true,
  });
  const updated = await prepareRasterReconstruction(job.id, { referenceRaster });
  return updated?.referenceRaster || referenceRaster;
}

async function ensureVectorReference(job: ReconstructionJob) {
  if (job.referenceRaster) {
    return job.referenceRaster;
  }

  const referenceRaster = await exportSingleNodeImage(job.input.targetSessionId, job.referenceNode.id, {
    preferOriginalBytes: true,
  });
  const updated = await prepareVectorReconstruction(job.id, { referenceRaster });
  return updated?.referenceRaster || referenceRaster;
}

async function ensureHybridReference(job: ReconstructionJob) {
  if (job.referenceRaster) {
    return job.referenceRaster;
  }

  const referenceRaster = await exportSingleNodeImage(job.input.targetSessionId, job.referenceNode.id, {
    preferOriginalBytes: true,
  });
  const updated = await prepareHybridReconstruction(job.id, { referenceRaster });
  return updated?.referenceRaster || referenceRaster;
}

async function normalizeRebuildCommands(job: Awaited<ReturnType<typeof getReconstructionJob>>) {
  if (!job?.rebuildPlan) {
    throw new Error("Reconstruction job is missing rebuildPlan.");
  }

  const namePrefix = `AD Rebuild/${job.id}`;
  const allowRasterBase = isHybridReconstructionJob(job);
  const remappedHybridRaster = allowRasterBase ? await remapHybridReferenceRaster(job) : null;
  let surfaceIndex = 0;
  let textIndex = 0;
  let primitiveIndex = 0;

  const vectorCapabilityIds = new Set([
    "nodes.create-rectangle",
    "nodes.create-ellipse",
    "nodes.create-line",
    "nodes.create-svg",
  ]);

  const normalizedOps = job.rebuildPlan.ops.map((command): FigmaCapabilityCommand => {
    if (command.type !== "capability") {
      throw new Error("Rebuild plan contains a non-capability command.");
    }
    const isRasterBase = command.capabilityId === "reconstruction.apply-raster-reference";
    if (
      command.capabilityId !== "nodes.create-frame" &&
      command.capabilityId !== "nodes.create-text" &&
      !vectorCapabilityIds.has(command.capabilityId) &&
      !(allowRasterBase && isRasterBase)
    ) {
      throw new Error(`Rebuild plan contains unsupported capability: ${command.capabilityId}.`);
    }

    if (isRasterBase) {
      const payload =
        command.payload as FigmaCapabilityCommand<"reconstruction.apply-raster-reference">["payload"];
      return {
        type: "capability",
        capabilityId: "reconstruction.apply-raster-reference",
        executionMode: "strict",
        dryRun: command.dryRun,
        nodeIds: [job.targetNode.id],
        payload: {
          referenceNodeId: payload.referenceNodeId || job.referenceNode.id,
          ...(remappedHybridRaster ? { referenceDataUrl: remappedHybridRaster.dataUrl } : {}),
          resultName:
            typeof payload.resultName === "string" && payload.resultName.trim()
              ? payload.resultName.trim()
              : `${namePrefix}/RasterBase`,
          replaceTargetContents: payload.replaceTargetContents !== false,
          resizeTargetToReference: payload.resizeTargetToReference === true,
          fitMode: remappedHybridRaster ? "stretch" : payload.fitMode || "cover",
          ...(Number.isFinite(payload.x) ? { x: Number(payload.x) } : {}),
          ...(Number.isFinite(payload.y) ? { y: Number(payload.y) } : {}),
          ...(Number.isFinite(payload.width)
            ? { width: Number(payload.width) }
            : remappedHybridRaster
              ? { width: remappedHybridRaster.width }
              : {}),
          ...(Number.isFinite(payload.height)
            ? { height: Number(payload.height) }
            : remappedHybridRaster
              ? { height: remappedHybridRaster.height }
              : {}),
          ...(Number.isFinite(payload.opacity) ? { opacity: Number(payload.opacity) } : {}),
        },
      } satisfies FigmaCapabilityCommand<"reconstruction.apply-raster-reference">;
    }

    if (command.capabilityId === "nodes.create-frame") {
      const payload = command.payload as FigmaCapabilityCommand<"nodes.create-frame">["payload"];
      surfaceIndex += 1;
      return {
        type: "capability",
        capabilityId: "nodes.create-frame",
        executionMode: "strict",
        dryRun: command.dryRun,
        nodeIds: command.nodeIds,
        payload: {
          ...payload,
          name:
            typeof payload.name === "string" && payload.name.trim()
              ? payload.name.trim()
              : `${namePrefix}/Surface ${surfaceIndex}`,
          parentNodeId: payload.parentNodeId || job.targetNode.id,
        },
      } satisfies FigmaCapabilityCommand<"nodes.create-frame">;
    }

    if (command.capabilityId === "nodes.create-text") {
      const payload = command.payload as FigmaCapabilityCommand<"nodes.create-text">["payload"];
      textIndex += 1;
      return {
        type: "capability",
        capabilityId: "nodes.create-text",
        executionMode: "strict",
        dryRun: command.dryRun,
        nodeIds: command.nodeIds,
        payload: {
          ...payload,
          name:
            typeof payload.name === "string" && payload.name.trim()
              ? payload.name.trim()
              : `${namePrefix}/Text ${textIndex}`,
          parentNodeId: payload.parentNodeId || job.targetNode.id,
        },
      } satisfies FigmaCapabilityCommand<"nodes.create-text">;
    }

    primitiveIndex += 1;
    if (command.capabilityId === "nodes.create-rectangle") {
      const payload = command.payload as FigmaCapabilityCommand<"nodes.create-rectangle">["payload"];
      return {
        type: "capability",
        capabilityId: "nodes.create-rectangle",
        executionMode: "strict",
        dryRun: command.dryRun,
        nodeIds: command.nodeIds,
        payload: {
          ...payload,
          name:
            typeof payload.name === "string" && payload.name.trim()
              ? payload.name.trim()
              : `${namePrefix}/Primitive ${primitiveIndex}`,
          parentNodeId: payload.parentNodeId || job.targetNode.id,
        },
      } satisfies FigmaCapabilityCommand<"nodes.create-rectangle">;
    }

    if (command.capabilityId === "nodes.create-ellipse") {
      const payload = command.payload as FigmaCapabilityCommand<"nodes.create-ellipse">["payload"];
      return {
        type: "capability",
        capabilityId: "nodes.create-ellipse",
        executionMode: "strict",
        dryRun: command.dryRun,
        nodeIds: command.nodeIds,
        payload: {
          ...payload,
          name:
            typeof payload.name === "string" && payload.name.trim()
              ? payload.name.trim()
              : `${namePrefix}/Primitive ${primitiveIndex}`,
          parentNodeId: payload.parentNodeId || job.targetNode.id,
        },
      } satisfies FigmaCapabilityCommand<"nodes.create-ellipse">;
    }

    if (command.capabilityId === "nodes.create-line") {
      const payload = command.payload as FigmaCapabilityCommand<"nodes.create-line">["payload"];
      return {
        type: "capability",
        capabilityId: "nodes.create-line",
        executionMode: "strict",
        dryRun: command.dryRun,
        nodeIds: command.nodeIds,
        payload: {
          ...payload,
          name:
            typeof payload.name === "string" && payload.name.trim()
              ? payload.name.trim()
              : `${namePrefix}/Primitive ${primitiveIndex}`,
          parentNodeId: payload.parentNodeId || job.targetNode.id,
        },
      } satisfies FigmaCapabilityCommand<"nodes.create-line">;
    }

    const payload = command.payload as FigmaCapabilityCommand<"nodes.create-svg">["payload"];
    return {
      type: "capability",
      capabilityId: "nodes.create-svg",
      executionMode: "strict",
      dryRun: command.dryRun,
      nodeIds: command.nodeIds,
      payload: {
        ...payload,
        name:
          typeof payload.name === "string" && payload.name.trim()
            ? payload.name.trim()
            : `${namePrefix}/Primitive ${primitiveIndex}`,
        parentNodeId: payload.parentNodeId || job.targetNode.id,
      },
    } satisfies FigmaCapabilityCommand<"nodes.create-svg">;
  });

  return [...normalizedOps, ...buildHybridCompletionPatchCommands(job)];
}

function buildEmbeddedCropSvg(
  dataUrl: string,
  sourceWidth: number,
  sourceHeight: number,
  crop: ReconstructionBounds,
  outputWidth: number,
  outputHeight: number,
) {
  const cropX = Math.max(0, Math.round(crop.x * sourceWidth));
  const cropY = Math.max(0, Math.round(crop.y * sourceHeight));
  const cropWidth = Math.max(1, Math.round(crop.width * sourceWidth));
  const cropHeight = Math.max(1, Math.round(crop.height * sourceHeight));
  const imageWidth = Math.max(1, Math.round((sourceWidth * outputWidth) / cropWidth));
  const imageHeight = Math.max(1, Math.round((sourceHeight * outputHeight) / cropHeight));
  const imageX = -Math.round((cropX * outputWidth) / cropWidth);
  const imageY = -Math.round((cropY * outputHeight) / cropHeight);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${outputWidth} ${outputHeight}">`,
    `<clipPath id="clip"><rect x="0" y="0" width="${outputWidth}" height="${outputHeight}" rx="0" ry="0" /></clipPath>`,
    `<g clip-path="url(#clip)">`,
    `<image href="${dataUrl}" x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="none" />`,
    `</g>`,
    `</svg>`,
  ].join("");
}

function buildHybridCompletionPatchCommands(
  job: Awaited<ReturnType<typeof getReconstructionJob>>,
): FigmaCapabilityCommand[] {
  if (!job || !isHybridReconstructionJob(job) || !job.analysis || !job.referenceRaster) {
    return [];
  }

  const approvedAssetIds = new Set(
    job.approvedAssetChoices.filter((choice) => choice.decision === "approved").map((choice) => choice.assetId),
  );
  if (!approvedAssetIds.size || !job.analysis.completionZones.length) {
    return [];
  }

  const approvedSlices = job.analysis.assetCandidates
    .filter(
      (asset) =>
        approvedAssetIds.has(asset.id) &&
        (asset.kind === "texture" || asset.kind === "background-slice") &&
        asset.extractMode !== "ignore",
    )
    .sort((left, right) => boundsArea(right.bounds) - boundsArea(left.bounds));

  if (!approvedSlices.length) {
    return [];
  }

  const targetWidth = job.targetNode.width || job.analysis.canonicalFrame?.width || job.analysis.width;
  const targetHeight = job.targetNode.height || job.analysis.canonicalFrame?.height || job.analysis.height;
  const sourceWidth = Math.max(1, job.analysis.width || job.referenceRaster.width);
  const sourceHeight = Math.max(1, job.analysis.height || job.referenceRaster.height);

  return job.analysis.completionZones.map((zone, index) => {
    const slice = approvedSlices[index % approvedSlices.length];
    const projected = projectBounds(zone.bounds, targetWidth, targetHeight);
    return {
      type: "capability",
      capabilityId: "nodes.create-svg",
      executionMode: "strict",
      payload: {
        name: `AD Rebuild/${job.id}/Completion/${zone.id}`,
        svgMarkup: buildEmbeddedCropSvg(
          job.referenceRaster!.dataUrl,
          sourceWidth,
          sourceHeight,
          slice.bounds,
          projected.width,
          projected.height,
        ),
        x: projected.x,
        y: projected.y,
        width: projected.width,
        height: projected.height,
        opacity: 1,
        parentNodeId: job.targetNode.id,
        analysisRefId: zone.id,
      },
    } satisfies FigmaCapabilityCommand<"nodes.create-svg">;
  });
}

function buildStructureReport(
  job: ReconstructionJob,
  targetNode: PluginNodeSummary,
): ReconstructionStructureReport | null {
  if (!isVectorReconstructionJob(job) && !isHybridReconstructionJob(job)) {
    return null;
  }

  const ops = job.rebuildPlan?.ops.filter((op) => op.type === "capability") || [];
  const textNodeCount = ops.filter((op) => op.capabilityId === "nodes.create-text").length;
  const vectorNodeCount = ops.filter((op) =>
    op.capabilityId === "nodes.create-rectangle" ||
    op.capabilityId === "nodes.create-ellipse" ||
    op.capabilityId === "nodes.create-line" ||
    op.capabilityId === "nodes.create-svg"
  ).length;
  const imageFillNodeCount = ops.filter((op) => op.capabilityId === "reconstruction.apply-raster-reference").length;
  const inferredTextCount = job.analysis?.textBlocks.filter((block) => block.inferred).length || 0;
  const expectedWidth = Number(job.targetNode.width || 0);
  const expectedHeight = Number(job.targetNode.height || 0);
  const actualWidth = Number(targetNode.width || 0);
  const actualHeight = Number(targetNode.height || 0);
  const targetFramePreserved =
    expectedWidth > 0 && expectedHeight > 0
      ? Math.abs(actualWidth - expectedWidth) < 0.5 && Math.abs(actualHeight - expectedHeight) < 0.5
      : null;

  const issues: string[] = [];
  if (targetFramePreserved === false) {
    issues.push(
      `target frame 尺寸发生变化: expected ${expectedWidth}x${expectedHeight}, actual ${actualWidth}x${actualHeight}`,
    );
  }
  if (isVectorReconstructionJob(job) && imageFillNodeCount > 0) {
    issues.push("vector-reconstruction 结果中检测到 raster/image-fill 写回。");
  }
  if (isVectorReconstructionJob(job) && textNodeCount + vectorNodeCount === 0) {
    issues.push("vector-reconstruction rebuild plan 没有生成任何可编辑节点。");
  }
  if (isHybridReconstructionJob(job) && imageFillNodeCount === 0) {
    issues.push("hybrid-reconstruction rebuild plan 没有写入 raster base。");
  }
  if (isHybridReconstructionJob(job) && textNodeCount + vectorNodeCount === 0) {
    issues.push("hybrid-reconstruction rebuild plan 没有生成任何可编辑 overlay 节点。");
  }

  return {
    targetFramePreserved,
    imageFillNodeCount,
    textNodeCount,
    vectorNodeCount,
    inferredTextCount,
    passed: issues.length === 0,
    issues,
  };
}

type AppliedRebuildNode = {
  nodeId: string;
  kind: "surface" | "text";
  normalizedBounds: ReconstructionBounds;
  absoluteBounds: ReconstructionBounds;
  fillHex: string | null;
  textCandidate: ReconstructionTextCandidate | null;
  region: ReconstructionRegion | null;
  fontMatch: ReconstructionFontMatch | null;
};

function projectBounds(
  bounds: ReconstructionBounds,
  targetWidth: number,
  targetHeight: number,
): ReconstructionBounds {
  return {
    x: Math.round(bounds.x * targetWidth),
    y: Math.round(bounds.y * targetHeight),
    width: Math.max(8, Math.round(bounds.width * targetWidth)),
    height: Math.max(8, Math.round(bounds.height * targetHeight)),
  };
}

function boundsArea(bounds: ReconstructionBounds) {
  return Math.max(0, bounds.width) * Math.max(0, bounds.height);
}

function overlapScore(left: ReconstructionBounds, right: ReconstructionBounds) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const intersection = width * height;
  if (!intersection) {
    return 0;
  }
  const union = boundsArea(left) + boundsArea(right) - intersection;
  return union > 0 ? intersection / union : 0;
}

function blendBounds(
  left: ReconstructionBounds,
  right: ReconstructionBounds,
  ratio: number,
): ReconstructionBounds {
  const clamped = Math.max(0, Math.min(1, ratio));
  const inverse = 1 - clamped;
  return {
    x: Math.round(left.x * inverse + right.x * clamped),
    y: Math.round(left.y * inverse + right.y * clamped),
    width: Math.max(8, Math.round(left.width * inverse + right.width * clamped)),
    height: Math.max(8, Math.round(left.height * inverse + right.height * clamped)),
  };
}

function uniqueHexPalette(job: ReconstructionJob) {
  return uniqueStrings([
    job.analysis?.styleHints.primaryColorHex || "",
    job.analysis?.styleHints.accentColorHex || "",
    ...(job.analysis?.dominantColors || []),
  ]);
}

function buildAppliedRebuildNodes(job: ReconstructionJob): AppliedRebuildNode[] {
  if (!job.analysis || !job.rebuildPlan) {
    return [];
  }

  const targetWidth = job.targetNode.width || job.analysis.width;
  const targetHeight = job.targetNode.height || job.analysis.height;
  const appliedNodes: AppliedRebuildNode[] = [];
  let surfaceIndex = 0;
  let textIndex = 0;

  job.rebuildPlan.ops.forEach((command, index) => {
    const nodeId = job.appliedNodeIds[index];
    if (!nodeId || command.type !== "capability") {
      return;
    }

    if (command.capabilityId === "nodes.create-frame") {
      const region = job.analysis?.layoutRegions[surfaceIndex] || null;
      surfaceIndex += 1;
      if (!region) {
        return;
      }
      const payload = command.payload as FigmaCapabilityCommand<"nodes.create-frame">["payload"];
      appliedNodes.push({
        nodeId,
        kind: "surface",
        normalizedBounds: region.bounds,
        absoluteBounds: {
          x: Number.isFinite(payload.x) ? Number(payload.x) : projectBounds(region.bounds, targetWidth, targetHeight).x,
          y: Number.isFinite(payload.y) ? Number(payload.y) : projectBounds(region.bounds, targetWidth, targetHeight).y,
          width: Number.isFinite(payload.width)
            ? Number(payload.width)
            : projectBounds(region.bounds, targetWidth, targetHeight).width,
          height: Number.isFinite(payload.height)
            ? Number(payload.height)
            : projectBounds(region.bounds, targetWidth, targetHeight).height,
        },
        fillHex: payload.fillHex || region.fillHex || job.analysis?.styleHints.accentColorHex || null,
        textCandidate: null,
        region,
        fontMatch: null,
      });
      return;
    }

    if (command.capabilityId === "nodes.create-text") {
      const textCandidate = job.analysis?.textCandidates[textIndex] || null;
      const fontMatch =
        textCandidate && job.fontMatches.find((item) => item.textCandidateId === textCandidate.id)
          ? job.fontMatches.find((item) => item.textCandidateId === textCandidate.id) || null
          : null;
      textIndex += 1;
      if (!textCandidate) {
        return;
      }
      const payload = command.payload as FigmaCapabilityCommand<"nodes.create-text">["payload"];
      const projected = projectBounds(textCandidate.bounds, targetWidth, targetHeight);
      appliedNodes.push({
        nodeId,
        kind: "text",
        normalizedBounds: textCandidate.bounds,
        absoluteBounds: {
          x: Number.isFinite(payload.x) ? Number(payload.x) : projected.x,
          y: Number.isFinite(payload.y) ? Number(payload.y) : projected.y,
          width: projected.width,
          height: projected.height,
        },
        fillHex: payload.colorHex || null,
        textCandidate,
        region: null,
        fontMatch,
      });
    }
  });

  return appliedNodes;
}

function findBestAppliedNode(
  nodes: AppliedRebuildNode[],
  kind: AppliedRebuildNode["kind"],
  normalizedBounds: ReconstructionBounds | null,
) {
  const candidates = nodes.filter((node) => node.kind === kind);
  if (!candidates.length) {
    return null;
  }
  if (!normalizedBounds) {
    return candidates[0];
  }
  return [...candidates].sort(
    (left, right) =>
      overlapScore(right.normalizedBounds, normalizedBounds) -
      overlapScore(left.normalizedBounds, normalizedBounds),
  )[0];
}

function isActionableSuggestion(job: ReconstructionJob, suggestion: ReconstructionJob["refineSuggestions"][number]) {
  return (
    suggestion.kind !== "manual-review" &&
    suggestion.confidence >= RECONSTRUCTION_ACTIONABLE_CONFIDENCE &&
    job.applyStatus === "applied"
  );
}

function resolveLoopStopReason(job: ReconstructionJob): ReconstructionLoopStopReason | null {
  if (job.stopReason) {
    return job.stopReason;
  }
  if (job.status === "completed") {
    const compositeScore = job.diffMetrics?.compositeScore || job.diffScore || 0;
    const hardGateFailed = Boolean(job.diffMetrics?.acceptanceGates.some((gate) => gate.hard && !gate.passed));
    if (compositeScore >= 0.9 && !hardGateFailed) {
      return "target_reached";
    }
    if (job.iterationCount >= job.input.maxIterations) {
      return "max_iterations";
    }
    if (job.stagnationCount >= 2) {
      return "stalled";
    }
    return "no_actionable_suggestions";
  }
  return null;
}

function buildAutoRefineCommands(job: ReconstructionJob) {
  if (!job.analysis || !job.rebuildPlan || !job.appliedNodeIds.length) {
    return {
      commands: [] as FigmaCapabilityCommand[],
      warnings: ["Reconstruction job 缺少分析结果或已应用节点，无法生成自动 refine 命令。"],
    };
  }

  const appliedNodes = buildAppliedRebuildNodes(job);
  const targetWidth = job.targetNode.width || job.analysis.width;
  const targetHeight = job.targetNode.height || job.analysis.height;
  const palette = uniqueHexPalette(job);
  const issued = new Set<string>();
  const commands: FigmaCapabilityCommand[] = [];
  const warnings: string[] = [];

  const pushCommand = (command: FigmaCapabilityCommand) => {
    const key = JSON.stringify({
      capabilityId: command.capabilityId,
      nodeIds: command.nodeIds || [],
      payload: command.payload,
    });
    if (issued.has(key)) {
      return;
    }
    issued.add(key);
    commands.push(command);
  };

  for (const suggestion of job.refineSuggestions) {
    if (!isActionableSuggestion(job, suggestion)) {
      continue;
    }

    if (suggestion.kind === "nudge-fill") {
      const node = findBestAppliedNode(appliedNodes, "surface", suggestion.bounds);
      if (!node) {
        warnings.push("没有找到可执行 fill refine 的 surface 节点。");
        continue;
      }
      const preferredHex =
        node.region?.fillHex ||
        (node.region?.kind === "emphasis"
          ? job.analysis.styleHints.accentColorHex
          : job.analysis.styleHints.primaryColorHex) ||
        palette[0] ||
        node.fillHex;
      const fillHex =
        job.stagnationCount > 0
          ? palette.find((hex) => hex !== preferredHex && hex !== node.fillHex) || preferredHex
          : preferredHex;
      if (!fillHex) {
        warnings.push(`节点 ${node.nodeId} 缺少可用 fill 颜色。`);
        continue;
      }
      pushCommand({
        type: "capability",
        capabilityId: "fills.set-fill",
        nodeIds: [node.nodeId],
        payload: { hex: fillHex },
      });
      continue;
    }

    if (suggestion.kind === "nudge-layout") {
      const node = findBestAppliedNode(appliedNodes, "surface", suggestion.bounds);
      if (!node) {
        warnings.push("没有找到可执行 layout refine 的 surface 节点。");
        continue;
      }

      const hotspotBounds = suggestion.bounds
        ? projectBounds(suggestion.bounds, targetWidth, targetHeight)
        : node.absoluteBounds;
      const targetBounds = blendBounds(node.absoluteBounds, hotspotBounds, 0.35);

      pushCommand({
        type: "capability",
        capabilityId: "geometry.set-position",
        nodeIds: [node.nodeId],
        payload: { x: targetBounds.x, y: targetBounds.y },
      });
      pushCommand({
        type: "capability",
        capabilityId: "geometry.set-size",
        nodeIds: [node.nodeId],
        payload: { width: targetBounds.width, height: targetBounds.height },
      });
      continue;
    }

    if (suggestion.kind === "nudge-text") {
      const node = findBestAppliedNode(appliedNodes, "text", suggestion.bounds);
      if (!node || !node.textCandidate) {
        warnings.push("没有找到可执行 text refine 的文本节点。");
        continue;
      }

      const hotspotBounds = suggestion.bounds
        ? projectBounds(suggestion.bounds, targetWidth, targetHeight)
        : node.absoluteBounds;
      const projectedBounds = projectBounds(node.textCandidate.bounds, targetWidth, targetHeight);
      const targetBounds = blendBounds(projectedBounds, hotspotBounds, 0.25);
      const fontCandidates = node.fontMatch?.candidates || [];
      const fontFamily =
        job.stagnationCount > 0 ? fontCandidates[1] || node.fontMatch?.recommended : node.fontMatch?.recommended;
      const fontSize = Math.max(12, Math.round(projectedBounds.height * 0.82));
      const textColorHex =
        job.analysis.styleHints.theme === "dark"
          ? "#F5F7FF"
          : "#111111";

      pushCommand({
        type: "capability",
        capabilityId: "geometry.set-position",
        nodeIds: [node.nodeId],
        payload: { x: targetBounds.x, y: targetBounds.y },
      });
      pushCommand({
        type: "capability",
        capabilityId: "text.set-font-size",
        nodeIds: [node.nodeId],
        payload: { value: fontSize },
      });
      if (fontFamily) {
        pushCommand({
          type: "capability",
          capabilityId: "text.set-font-family",
          nodeIds: [node.nodeId],
          payload: { family: fontFamily },
        });
      }
      pushCommand({
        type: "capability",
        capabilityId: "text.set-text-color",
        nodeIds: [node.nodeId],
        payload: { hex: textColorHex },
      });
    }
  }

  return {
    commands: commands.slice(0, 8),
    warnings,
  };
}

function assertSuccessfulCommandRecord(
  command: PluginBridgeCommandRecord,
  contextLabel: string,
  options?: { allowMissingWarnings?: boolean },
) {
  if (command.status !== "succeeded") {
    throw new Error(command.resultMessage || `${contextLabel} failed.`);
  }

  const failedResult = command.results.find((result) => !result.ok);
  if (failedResult) {
    throw new Error(failedResult.message || `${contextLabel} failed.`);
  }

  const warnings = collectCommandWarnings(command);
  if (!warnings.length) {
    return warnings;
  }

  if (options?.allowMissingWarnings) {
    const unexpected = warnings.filter((warning) => !warning.includes("未找到"));
    if (!unexpected.length) {
      return warnings;
    }
    throw new Error(`${contextLabel} returned warnings: ${unexpected.join(" | ")}`);
  }

  throw new Error(`${contextLabel} returned warnings: ${warnings.join(" | ")}`);
}

async function clearReconstructionNodes(job: NonNullable<Awaited<ReturnType<typeof getReconstructionJob>>>) {
  let generatedNodeIds: string[] = [];
  const fallbackWarnings: string[] = [];
  try {
    const inspectedNodes = await inspectFrameSubtree(job.input.targetSessionId, job.targetNode.id, {
      maxDepth: 8,
    });
    generatedNodeIds = uniqueStrings(
      inspectedNodes
        .filter((node) => node.id !== job.targetNode.id && isReconstructionGeneratedInspectionNode(node))
        .sort((left, right) => right.depth - left.depth)
        .map((node) => node.id),
    );
  } catch (error) {
    fallbackWarnings.push(
      `未能检查目标 Frame 子树，已回退到仅删除当前 job 记录的已应用节点。原因: ${error instanceof Error ? error.message : "inspect failed"}`,
    );
  }
  const nodeIdsToDelete = uniqueStrings([...generatedNodeIds, ...job.appliedNodeIds]).filter(
    (nodeId) => nodeId !== job.targetNode.id,
  );

  if (!nodeIdsToDelete.length) {
    return {
      warnings: fallbackWarnings,
      deletedNodeIds: [] as string[],
    };
  }

  const command = await queueAndWaitForPluginBatch(job.input.targetSessionId, [
    {
      type: "capability",
      capabilityId: "nodes.delete",
      payload: {},
      nodeIds: nodeIdsToDelete,
      executionMode: "strict",
    },
  ]);

  const warnings = assertSuccessfulCommandRecord(command, "Reconstruction clear", {
    allowMissingWarnings: true,
  });

  return {
    warnings: uniqueStrings([...fallbackWarnings, ...warnings]),
    deletedNodeIds: collectChangedNodeIds(command),
  };
}

async function handleInspectFrame(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
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

function findSelectionNode(session: PluginBridgeSession, nodeId: string) {
  return (Array.isArray(session.selection) ? session.selection : []).find((node) => node.id === nodeId) || null;
}

async function waitForSessionSelectionNode(
  sessionId: string,
  nodeId: string,
  options?: { requirePreview?: boolean },
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= pluginCommandWaitTimeoutMs) {
    const snapshot = await getPluginBridgeSnapshot();
    const session = findSessionById(snapshot.sessions, sessionId);
    if (session && session.status === "online") {
      const node = findSelectionNode(session, nodeId);
      if (node && (!options?.requirePreview || Boolean(node.previewDataUrl))) {
        return {
          session,
          node,
        };
      }
    }

    await sleep(pluginCommandPollIntervalMs);
  }

  throw new Error(`Timed out waiting for selection preview of node ${nodeId}.`);
}

async function refreshSessionSelection(targetSessionId: string) {
  return queueAndWaitForPluginBatch(targetSessionId, [
    {
      type: "capability",
      capabilityId: "selection.refresh",
      payload: {},
      executionMode: "strict",
    },
  ]);
}

async function renderReconstructionPreview(job: ReconstructionJob) {
  const artifact = await exportSingleNodeImage(job.input.targetSessionId, job.targetNode.id, {
    preferOriginalBytes: false,
  });
  const targetNode: PluginNodeSummary = {
    ...job.targetNode,
    width: artifact.width,
    height: artifact.height,
    previewDataUrl: artifact.dataUrl,
  };

  return {
    targetNode,
    renderedPreview: createRenderedPreview(
      artifact.dataUrl,
      artifact.width,
      artifact.height,
    ),
  };
}

async function runReconstructionIteration(jobId: string) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    throw new Error("Reconstruction job not found");
  }
  if (isRasterExactJob(job)) {
    throw new Error("raster-exact job 不支持 iterate/refine loop。请直接使用 render + measure 验证结果。");
  }
  if (!job.analysis) {
    throw new Error("Reconstruction job has no analysis yet");
  }
  if (job.applyStatus !== "applied") {
    throw new Error("Reconstruction job must be applied before running diff iteration");
  }

  const rendered = await renderReconstructionPreview(job);
  const renderedJob = await markReconstructionRendered(jobId, rendered);
  if (!renderedJob) {
    throw new Error("Reconstruction job not found");
  }

  const diffMetrics = await measurePreviewDiff(
    renderedJob.analysis?.previewDataUrl || job.analysis.previewDataUrl,
    rendered.renderedPreview.previewDataUrl,
  );

  const measuredJob = await markReconstructionMeasured(jobId, { diffMetrics });
  if (!measuredJob) {
    throw new Error("Reconstruction job not found");
  }

  const refineSuggestions = buildRefineSuggestions(measuredJob, diffMetrics);
  const refinedJob = await markReconstructionRefined(jobId, { refineSuggestions });
  if (!refinedJob) {
    throw new Error("Reconstruction job not found");
  }

  return refinedJob;
}

async function runReconstructionLoop(jobId: string) {
  let job = await getReconstructionJob(jobId);
  if (!job) {
    throw new Error("Reconstruction job not found");
  }
  if (isRasterExactJob(job)) {
    throw new Error("raster-exact job 不支持自动 refine loop。");
  }
  if (!job.analysis) {
    throw new Error("Reconstruction job has no analysis yet");
  }
  if (job.applyStatus !== "applied") {
    throw new Error("Reconstruction job must be applied before running auto refine loop");
  }
  await requireLoopCompatibleSession(job.input.targetSessionId);

  const running = await markReconstructionLoopStatus(jobId, {
    loopStatus: "running",
    stopReason: null,
  });
  if (!running) {
    throw new Error("Reconstruction job not found");
  }
  job = running;

  const safetyLimit = Math.max(1, job.input.maxIterations + 1);
  for (let cycle = 0; cycle < safetyLimit; cycle += 1) {
    if (!job.diffMetrics || !job.refineSuggestions.length) {
      job = await runReconstructionIteration(jobId);
    }

    const stopReason = resolveLoopStopReason(job);
    if (stopReason || job.status === "completed") {
      const stopped = await markReconstructionLoopStatus(jobId, {
        loopStatus: "stopped",
        stopReason: stopReason || job.stopReason || "no_actionable_suggestions",
      });
      return stopped || job;
    }

    const refinement = buildAutoRefineCommands(job);
    if (!refinement.commands.length) {
      const stopped = await markReconstructionLoopStatus(jobId, {
        loopStatus: "stopped",
        stopReason: "no_actionable_suggestions",
        warnings: refinement.warnings.length
          ? refinement.warnings
          : ["当前没有可执行的自动 refine 命令。"],
      });
      return stopped || job;
    }

    const command = await queueAndWaitForPluginBatch(job.input.targetSessionId, refinement.commands);
    const commandWarnings = assertSuccessfulCommandRecord(command, "Reconstruction loop refine");
    job = (await runReconstructionIteration(jobId)) || job;

    if (commandWarnings.length || refinement.warnings.length) {
      const refreshed = await markReconstructionLoopStatus(jobId, {
        loopStatus: job.status === "completed" ? "stopped" : "running",
        stopReason: job.status === "completed" ? job.stopReason : null,
        warnings: [...commandWarnings, ...refinement.warnings],
      });
      if (refreshed) {
        job = refreshed;
      }
    }
  }

  const stopped = await markReconstructionLoopStatus(jobId, {
    loopStatus: "stopped",
    stopReason: "max_iterations",
    warnings: ["自动 refine 触发了 server safety limit，已强制停止。"],
  });
  return stopped || job;
}

function resolveReconstructionNodes(
  session: PluginBridgeSession,
  payload: CreateReconstructionJobPayload,
) {
  const selection = Array.isArray(session.selection) ? session.selection : [];
  const targetNode = payload.targetNodeId
    ? selection.find((node) => node.id === payload.targetNodeId) || null
    : null;
  const referenceNode = payload.referenceNodeId
    ? selection.find((node) => node.id === payload.referenceNodeId) || null
    : null;

  const frameCandidates = selection.filter((node) => node.type === "FRAME");
  const imageCandidates = selection.filter((node) => node.fills.includes("image"));

  const resolvedTarget = targetNode || (frameCandidates.length === 1 ? frameCandidates[0] : null);
  const resolvedReference =
    referenceNode || (imageCandidates.length === 1 ? imageCandidates[0] : null);

  if (!resolvedTarget) {
    throw new Error("没有找到唯一可用的目标 Frame。请显式提供 targetNodeId，或确保 selection 中只有一个 Frame。");
  }

  if (!resolvedReference) {
    throw new Error(
      "没有找到唯一可用的参考图片节点。请显式提供 referenceNodeId，或确保 selection 中只有一个图片节点。",
    );
  }

  if (resolvedTarget.id === resolvedReference.id) {
    throw new Error("目标节点和参考节点不能是同一个节点。");
  }

  if (resolvedTarget.type !== "FRAME") {
    throw new Error(`目标节点必须是 FRAME，当前为 ${resolvedTarget.type}。`);
  }

  if (
    !resolvedReference.fills.includes("image") &&
    !(typeof resolvedReference.previewDataUrl === "string" && resolvedReference.previewDataUrl)
  ) {
    throw new Error("参考节点必须是可预览的图片节点。");
  }

  return {
    targetNode: resolvedTarget,
    referenceNode: resolvedReference,
  };
}

async function handleReconstructionJobCreate(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
) {
  const payload = await readBody<CreateReconstructionJobPayload>(request);
  if (!payload.targetSessionId) {
    sendJson(response, 400, { ok: false, error: "targetSessionId is required" });
    return;
  }

  const snapshot = await getPluginBridgeSnapshot();
  const session = findSessionById(snapshot.sessions, payload.targetSessionId);
  if (!session) {
    sendJson(response, 404, { ok: false, error: "Plugin session not found" });
    return;
  }

  try {
    const { targetNode, referenceNode } = resolveReconstructionNodes(session, payload);
    const warnings: string[] = [];

    if (payload.allowOutpainting) {
      warnings.push("allowOutpainting 已记录，但当前 tranche 仅建立任务，不会实际生成补图。");
    }

    const job = await createReconstructionJob(payload, targetNode, referenceNode, warnings);
    sendJson(response, 200, job);
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid reconstruction input",
    });
  }
}

async function handleReconstructionJobList(response: import("node:http").ServerResponse) {
  const snapshot = await listReconstructionJobs();
  sendJson(response, 200, snapshot);
}

async function handleReconstructionJobGet(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  sendJson(response, 200, job);
}

async function handleReconstructionJobAnalyze(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  try {
    if (isRasterExactJob(job)) {
      const referenceRaster = await ensureRasterReference(job);
      const updated = await prepareRasterReconstruction(jobId, { referenceRaster });
      if (!updated) {
        sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
        return;
      }
      sendJson(response, 200, updated);
      return;
    }
    if (isVectorReconstructionJob(job)) {
      const referenceRaster = await ensureVectorReference(job);
      const updated = await prepareVectorReconstruction(jobId, { referenceRaster });
      if (!updated) {
        sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
        return;
      }
      sendJson(response, 200, updated);
      return;
    }
    if (isHybridReconstructionJob(job)) {
      const referenceRaster = await ensureHybridReference(job);
      const updated = await prepareHybridReconstruction(jobId, { referenceRaster });
      if (!updated) {
        sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
        return;
      }
      sendJson(response, 200, updated);
      return;
    }

    const result = await runPreviewOnlyReconstructionAnalysis(job);
    const updated = await completeReconstructionAnalysis(jobId, result);
    if (!updated) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 200, updated);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Reconstruction analysis failed";
    const failed = await failReconstructionJob(jobId, job.currentStageId, detail);
    if (!failed) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 500, {
      ok: false,
      error: detail,
      job: failed,
    });
  }
}

async function handleReconstructionJobContextPack(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  try {
    const contextPack = buildReconstructionContextPack(job);
    sendJson(response, 200, contextPack satisfies ReconstructionContextPack);
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to build reconstruction context pack",
    });
  }
}

async function handleReconstructionJobSubmitAnalysis(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  const payload = await readBody<SubmitReconstructionAnalysisPayload>(request);
  if (payload.analysis === undefined) {
    sendJson(response, 400, { ok: false, error: "analysis is required" });
    return;
  }

  try {
    const normalized = buildNormalizedReconstructionAnalysis(job, {
      analysisVersion: payload.analysisVersion,
      analysisProvider: payload.analysisProvider || "codex-assisted",
      analysis: payload.analysis,
      fontMatches: payload.fontMatches,
      reviewFlags: payload.reviewFlags,
      warnings: payload.warnings,
    });
    const updated = await completeReconstructionAnalysis(jobId, normalized);
    if (!updated) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 200, updated);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to submit reconstruction analysis";
    const failed = await failReconstructionJob(jobId, job.currentStageId, detail);
    if (!failed) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 400, {
      ok: false,
      error: detail,
      job: failed,
    });
  }
}

async function handleReconstructionJobPreviewPlan(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }
  if (!job.rebuildPlan) {
    sendJson(response, 409, { ok: false, error: "Reconstruction job has no rebuild plan yet" });
    return;
  }
  sendJson(response, 200, job);
}

async function handleReconstructionJobReviewFont(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const payload = await readBody<ReviewReconstructionFontPayload>(request);
  if (!payload.textCandidateId || !payload.fontFamily) {
    sendJson(response, 400, { ok: false, error: "textCandidateId and fontFamily are required" });
    return;
  }

  try {
    const updated = await reviewReconstructionFontChoice(jobId, payload);
    if (!updated) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 200, updated);
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Reconstruction font review failed",
    });
  }
}

async function handleReconstructionJobReviewAsset(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const payload = await readBody<ReviewReconstructionAssetPayload>(request);
  if (!payload.assetId || !payload.decision) {
    sendJson(response, 400, { ok: false, error: "assetId and decision are required" });
    return;
  }

  try {
    const updated = await reviewReconstructionAssetChoice(jobId, payload);
    if (!updated) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 200, updated);
  } catch (error) {
    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : "Reconstruction asset review failed",
    });
  }
}

async function handleReconstructionJobApprovePlan(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const payload = await readBody<ApproveReconstructionPlanPayload>(request);
  if (typeof payload.approved !== "boolean") {
    sendJson(response, 400, { ok: false, error: "approved is required" });
    return;
  }

  const updated = await approveReconstructionPlan(jobId, payload);
  if (!updated) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }
  sendJson(response, 200, updated);
}

async function handleReconstructionJobApply(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  if (!isRasterExactJob(job) && !job.rebuildPlan) {
    sendJson(response, 409, { ok: false, error: "Reconstruction job has no rebuild plan yet" });
    return;
  }
  if (!isRasterExactJob(job) && job.approvalState !== "approved") {
    sendJson(response, 409, {
      ok: false,
      error: `Reconstruction job must be approved before apply. current approvalState=${job.approvalState}`,
      job,
    });
    return;
  }

  try {
    let accumulatedWarnings: string[] = [];
    let latestJob = job;

    if (isRasterExactJob(job) && !job.referenceRaster) {
      const referenceRaster = await ensureRasterReference(job);
      const prepared = await prepareRasterReconstruction(job.id, {
        referenceRaster,
      });
      if (prepared) {
        latestJob = prepared;
      }
    }
    if (isVectorReconstructionJob(job) && !job.referenceRaster) {
      const referenceRaster = await ensureVectorReference(job);
      const prepared = await prepareVectorReconstruction(job.id, {
        referenceRaster,
      });
      if (prepared) {
        latestJob = prepared;
      }
    }
    if (isHybridReconstructionJob(job) && !job.referenceRaster) {
      const referenceRaster = await ensureHybridReference(job);
      const prepared = await prepareHybridReconstruction(job.id, {
        referenceRaster,
      });
      if (prepared) {
        latestJob = prepared;
      }
    }

    const cleared = await clearReconstructionNodes(latestJob);
    accumulatedWarnings = uniqueStrings([...accumulatedWarnings, ...cleared.warnings]);
    const reset = await clearReconstructionAppliedState(job.id, {
      warnings: cleared.warnings,
      message: "等待重新写入 Figma。",
    });
    if (!reset) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }

    latestJob = (await getReconstructionJob(jobId)) || latestJob;
    if (!latestJob) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }

    if (isHybridReconstructionJob(latestJob) && latestJob.analysis?.completionZones.length) {
      const approvedCompletionSlices = latestJob.analysis.assetCandidates.filter((asset) =>
        latestJob.approvedAssetChoices.some(
          (choice) =>
            choice.assetId === asset.id &&
            choice.decision === "approved" &&
            (asset.kind === "texture" || asset.kind === "background-slice"),
        ),
      );
      if (!approvedCompletionSlices.length) {
        accumulatedWarnings = uniqueStrings([
          ...accumulatedWarnings,
          "当前 hybrid analysis 含 completionZones，但没有已批准的 texture/background-slice 候选；补边区域不会被 deterministic patch 填充。",
        ]);
      }
    }

    const command = isRasterExactJob(latestJob)
      ? await queueAndWaitForPluginBatch(latestJob.input.targetSessionId, [
          {
            type: "capability",
            capabilityId: "reconstruction.apply-raster-reference",
            nodeIds: [latestJob.targetNode.id],
            payload: {
              referenceNodeId: latestJob.referenceNode.id,
              resultName: `AD Rebuild/${latestJob.id}/Raster`,
              replaceTargetContents: true,
              resizeTargetToReference: true,
            },
            executionMode: "strict",
          },
        ])
      : await queueAndWaitForPluginBatch(
          latestJob.input.targetSessionId,
          await normalizeRebuildCommands(latestJob),
        );

    accumulatedWarnings = uniqueStrings([
      ...accumulatedWarnings,
      ...assertSuccessfulCommandRecord(command, "Reconstruction apply"),
    ]);

    const appliedNodeIds = collectChangedNodeIds(command);
    if (!appliedNodeIds.length) {
      throw new Error("Reconstruction apply completed without changedNodeIds.");
    }

    const updated = await markReconstructionApplied(jobId, {
      appliedNodeIds,
      warnings: accumulatedWarnings,
    });

    if (!updated) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }

    sendJson(response, 200, updated);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Reconstruction apply failed";
    const failed = await failReconstructionJob(jobId, "apply-rebuild", detail);
    if (!failed) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 500, {
      ok: false,
      error: detail,
      job: failed,
    });
  }
}

async function handleReconstructionJobClear(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  try {
    const cleared = await clearReconstructionNodes(job);
    const warnings = uniqueStrings(cleared.warnings);

    const updated = await clearReconstructionAppliedState(jobId, {
      warnings,
      message: "等待写入 Figma。",
    });

    if (!updated) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }

    sendJson(response, 200, updated);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Reconstruction clear failed";
    const failed = await failReconstructionJob(jobId, "apply-rebuild", detail);
    if (!failed) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 500, {
      ok: false,
      error: detail,
      job: failed,
    });
  }
}

async function handleReconstructionJobRender(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  try {
    if (job.applyStatus !== "applied") {
      throw new Error("Reconstruction job must be applied before rendering preview.");
    }

    const rendered = await renderReconstructionPreview(job);
    const updated = await markReconstructionRendered(jobId, {
      ...rendered,
      structureReport: buildStructureReport(job, rendered.targetNode),
    });
    if (!updated) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }

    sendJson(response, 200, updated);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Reconstruction render failed";
    const failed = await failReconstructionJob(jobId, "render-preview", detail);
    if (!failed) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 500, {
      ok: false,
      error: detail,
      job: failed,
    });
  }
}

async function handleReconstructionJobMeasure(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  try {
    if (!isRasterExactJob(job) && !job.analysis) {
      throw new Error("Reconstruction job has no analysis yet.");
    }
    if (!job.renderedPreview?.previewDataUrl) {
      throw new Error("Reconstruction job has no rendered preview yet.");
    }

    let referencePreviewDataUrl = job.referenceRaster?.dataUrl || null;
    if (!referencePreviewDataUrl && isRasterExactJob(job)) {
      referencePreviewDataUrl = (await ensureRasterReference(job)).dataUrl;
    }
    if (!referencePreviewDataUrl && isVectorReconstructionJob(job)) {
      referencePreviewDataUrl = (await ensureVectorReference(job)).dataUrl;
    }
    if (!referencePreviewDataUrl && isHybridReconstructionJob(job)) {
      referencePreviewDataUrl = (await ensureHybridReference(job)).dataUrl;
    }
    if (!referencePreviewDataUrl) {
      referencePreviewDataUrl = job.analysis?.previewDataUrl || null;
    }
    if (!referencePreviewDataUrl) {
      throw new Error("Reconstruction job has no reference preview available for diff measurement.");
    }
    const diffMetrics = await measurePreviewDiff(
      referencePreviewDataUrl,
      job.renderedPreview.previewDataUrl,
    );
    const updated = await markReconstructionMeasured(jobId, { diffMetrics });
    if (!updated) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }

    sendJson(response, 200, updated);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Reconstruction diff measurement failed";
    const failed = await failReconstructionJob(jobId, "measure-diff", detail);
    if (!failed) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 500, {
      ok: false,
      error: detail,
      job: failed,
    });
  }
}

async function handleReconstructionJobRefine(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  try {
    if (isRasterExactJob(job)) {
      throw new Error("raster-exact job 不支持 refine。请直接使用 render + measure 进行验收。");
    }
    if (isVectorReconstructionJob(job)) {
      throw new Error("vector-reconstruction 目前不支持自动 refine。请重新提交 analysis 后再 apply/render/measure。");
    }
    if (isHybridReconstructionJob(job)) {
      throw new Error("hybrid-reconstruction 当前先支持 apply/render/measure，暂不支持自动 refine。");
    }
    if (!job.diffMetrics) {
      throw new Error("Reconstruction job has no diff metrics yet.");
    }

    const refineSuggestions = buildRefineSuggestions(job, job.diffMetrics);
    const updated = await markReconstructionRefined(jobId, { refineSuggestions });
    if (!updated) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }

    sendJson(response, 200, updated);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Reconstruction refine failed";
    const failed = await failReconstructionJob(jobId, "refine", detail);
    if (!failed) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 500, {
      ok: false,
      error: detail,
      job: failed,
    });
  }
}

async function handleReconstructionJobIterate(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  try {
    if (isRasterExactJob(job)) {
      throw new Error("raster-exact job 不支持 iterate。请直接使用 render + measure。");
    }
    if (isVectorReconstructionJob(job)) {
      throw new Error("vector-reconstruction 目前不支持 iterate。请修改 analysis/rebuild plan 后重新 apply。");
    }
    if (isHybridReconstructionJob(job)) {
      throw new Error("hybrid-reconstruction 当前暂不支持 iterate。请重新提交 analysis 后再 apply/render/measure。");
    }
    const updated = await runReconstructionIteration(jobId);
    sendJson(response, 200, updated);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Reconstruction iteration failed";
    const failed = await failReconstructionJob(
      jobId,
      job.currentStageId === "measure-diff" ? "measure-diff" : "render-preview",
      detail,
    );
    if (!failed) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 500, {
      ok: false,
      error: detail,
      job: failed,
    });
  }
}

async function handleReconstructionJobLoop(
  response: import("node:http").ServerResponse,
  jobId: string,
) {
  const job = await getReconstructionJob(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
    return;
  }

  try {
    if (isRasterExactJob(job)) {
      throw new Error("raster-exact job 不支持自动 refine loop。");
    }
    if (isVectorReconstructionJob(job)) {
      throw new Error("vector-reconstruction 目前不支持自动 refine loop。");
    }
    if (isHybridReconstructionJob(job)) {
      throw new Error("hybrid-reconstruction 当前暂不支持自动 refine loop。");
    }
    const updated = await runReconstructionLoop(jobId);
    sendJson(response, 200, updated);
  } catch (error) {
    let detail = error instanceof Error ? error.message : "Reconstruction loop failed";
    if (detail.includes("指定的 nodeIds 在当前 selection 中未找到匹配节点")) {
      detail += " 当前运行中的 AutoDesign 插件会话很可能还是旧构建，请重新运行插件后再试。";
    }
    const failed = await failReconstructionJob(jobId, "refine", detail);
    if (!failed) {
      sendJson(response, 404, { ok: false, error: "Reconstruction job not found" });
      return;
    }
    sendJson(response, 500, {
      ok: false,
      error: detail,
      job: failed,
    });
  }
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

  if (context.pathname === "/api/plugin-bridge/inspect-frame" && context.method === "POST") {
    await handleInspectFrame(request, response);
    return;
  }

  if (context.pathname === "/api/reconstruction/jobs" && context.method === "GET") {
    await handleReconstructionJobList(response);
    return;
  }

  if (context.pathname === "/api/reconstruction/jobs" && context.method === "POST") {
    await handleReconstructionJobCreate(request, response);
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

  if (
    pathSegments.length === 4 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    context.method === "GET"
  ) {
    await handleReconstructionJobGet(response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "context-pack" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobContextPack(response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "submit-analysis" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobSubmitAnalysis(request, response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "preview-plan" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobPreviewPlan(response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 6 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "review" &&
    pathSegments[5] === "font" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobReviewFont(request, response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 6 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "review" &&
    pathSegments[5] === "asset" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobReviewAsset(request, response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 6 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "review" &&
    pathSegments[5] === "approve-plan" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobApprovePlan(request, response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "analyze" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobAnalyze(response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "apply" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobApply(response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "clear" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobClear(response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "render" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobRender(response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "measure" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobMeasure(response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "refine" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobRefine(response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "iterate" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobIterate(response, pathSegments[3]);
    return;
  }

  if (
    pathSegments.length === 5 &&
    pathSegments[0] === "api" &&
    pathSegments[1] === "reconstruction" &&
    pathSegments[2] === "jobs" &&
    pathSegments[4] === "loop" &&
    context.method === "POST"
  ) {
    await handleReconstructionJobLoop(response, pathSegments[3]);
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
