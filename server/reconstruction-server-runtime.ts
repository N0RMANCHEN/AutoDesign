import type {
  ReconstructionBounds,
  ReconstructionFontMatch,
  ReconstructionJob,
  ReconstructionLoopStopReason,
  ReconstructionRegion,
  ReconstructionTextCandidate,
} from "../shared/reconstruction.js";
import { RECONSTRUCTION_ACTIONABLE_CONFIDENCE } from "../shared/reconstruction.js";
import type { FigmaCapabilityCommand } from "../shared/plugin-contract.js";
import type { PluginNodeInspection } from "../shared/plugin-bridge.js";
import {
  getReconstructionJob,
  prepareHybridReconstruction,
  prepareRasterReconstruction,
  prepareVectorReconstruction,
} from "./reconstruction-store.js";
import {
  isHybridReconstructionJob,
  isRasterExactJob,
  isVectorReconstructionJob,
} from "./reconstruction-mode.js";
import { remapHybridReferenceRaster } from "./reconstruction-raster.js";
import { buildStructureReport } from "./reconstruction-structure-report.js";
import {
  createReconstructionJobFromSelection,
  resolveReconstructionNodes,
} from "./reconstruction-selection.js";
import {
  assertSuccessfulCommandRecord,
  exportSingleNodeImage,
  queueAndWaitForPluginBatch,
  uniqueStrings,
} from "./plugin-runtime-bridge.js";

export async function ensureRasterReference(job: ReconstructionJob) {
  if (job.referenceRaster) {
    return job.referenceRaster;
  }

  const referenceRaster = await exportSingleNodeImage(job.input.targetSessionId, job.referenceNode.id, {
    preferOriginalBytes: true,
  });
  const updated = await prepareRasterReconstruction(job.id, { referenceRaster });
  return updated?.referenceRaster || referenceRaster;
}

export async function ensureVectorReference(job: ReconstructionJob) {
  if (job.referenceRaster) {
    return job.referenceRaster;
  }

  const referenceRaster = await exportSingleNodeImage(job.input.targetSessionId, job.referenceNode.id, {
    preferOriginalBytes: true,
  });
  const updated = await prepareVectorReconstruction(job.id, { referenceRaster });
  return updated?.referenceRaster || referenceRaster;
}

export async function ensureHybridReference(job: ReconstructionJob) {
  if (job.referenceRaster) {
    return job.referenceRaster;
  }

  const referenceRaster = await exportSingleNodeImage(job.input.targetSessionId, job.referenceNode.id, {
    preferOriginalBytes: true,
  });
  const updated = await prepareHybridReconstruction(job.id, { referenceRaster });
  return updated?.referenceRaster || referenceRaster;
}

export async function resolveReferencePreviewForMeasurement(job: ReconstructionJob) {
  const rectifiedPreviewDataUrl = job.analysis?.screenPlane?.rectifiedPreviewDataUrl || null;
  if (rectifiedPreviewDataUrl) {
    return rectifiedPreviewDataUrl;
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

  return referencePreviewDataUrl;
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
  const passthroughCapabilityIds = new Set([
    "layout.configure-frame",
    "layout.configure-child",
  ]);

  const normalizedOps = job.rebuildPlan.ops.map((command): FigmaCapabilityCommand => {
    if (command.type !== "capability") {
      throw new Error("Rebuild plan contains a non-capability command.");
    }
    const isRasterBase = command.capabilityId === "reconstruction.apply-raster-reference";
    if (
      command.capabilityId !== "nodes.create-frame" &&
      command.capabilityId !== "nodes.create-text" &&
      !passthroughCapabilityIds.has(command.capabilityId) &&
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

    if (command.capabilityId === "layout.configure-frame") {
      const payload = command.payload as FigmaCapabilityCommand<"layout.configure-frame">["payload"];
      return {
        type: "capability",
        capabilityId: "layout.configure-frame",
        executionMode: "strict",
        dryRun: command.dryRun,
        nodeIds: command.nodeIds,
        payload,
      } satisfies FigmaCapabilityCommand<"layout.configure-frame">;
    }

    if (command.capabilityId === "layout.configure-child") {
      const payload = command.payload as FigmaCapabilityCommand<"layout.configure-child">["payload"];
      return {
        type: "capability",
        capabilityId: "layout.configure-child",
        executionMode: "strict",
        dryRun: command.dryRun,
        nodeIds: command.nodeIds,
        payload,
      } satisfies FigmaCapabilityCommand<"layout.configure-child">;
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

export function resolveLoopStopReason(job: ReconstructionJob): ReconstructionLoopStopReason | null {
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

export function buildAutoRefineCommands(job: ReconstructionJob) {
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

export {
  assertSuccessfulCommandRecord,
  buildStructureReport,
  createReconstructionJobFromSelection,
  exportSingleNodeImage,
  isHybridReconstructionJob,
  isRasterExactJob,
  isVectorReconstructionJob,
  normalizeRebuildCommands,
  queueAndWaitForPluginBatch,
  resolveReconstructionNodes,
  uniqueStrings,
};
