import type { FigmaCapabilityCommand } from "../shared/plugin-contract.js";
import type { ReconstructionBounds } from "../shared/reconstruction.js";
import { boundsArea, projectBounds } from "./reconstruction-runtime-geometry.js";
import { isHybridReconstructionJob } from "./reconstruction-mode.js";
import { remapHybridReferenceRaster } from "./reconstruction-raster.js";
import { getReconstructionJob } from "./reconstruction-store.js";

type LoadedReconstructionJob = Awaited<ReturnType<typeof getReconstructionJob>>;

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

function buildHybridCompletionPatchCommands(job: LoadedReconstructionJob): FigmaCapabilityCommand[] {
  if (!job || !isHybridReconstructionJob(job) || !job.analysis || !job.referenceRaster) {
    return [];
  }

  const referenceRaster = job.referenceRaster;
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
          referenceRaster.dataUrl,
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

export async function normalizeRebuildCommands(job: LoadedReconstructionJob) {
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
