import type { PluginCommandExecutionResult } from "../../../../shared/plugin-bridge.js";
import type { FigmaCapabilityCommand } from "../../../../shared/plugin-contract.js";

import { exportNodeImageArtifact } from "./selection-context.js";
import { supportsChildren } from "./node-style-helpers.js";

type SuccessResultFactory = (
  capabilityId: FigmaCapabilityCommand["capabilityId"],
  message: string,
  details?: Partial<Omit<PluginCommandExecutionResult, "capabilityId" | "ok" | "message">>,
) => PluginCommandExecutionResult;

type AssetCommandDeps = {
  getTargetNodes: (command: FigmaCapabilityCommand, batchSource?: string) => Promise<any[]>;
  successResult: SuccessResultFactory;
};

export function decodeDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("图片 dataUrl 格式无效。");
  }

  const base64 = match[2];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const normalized = base64.replace(/=+$/, "");
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value < 0) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 255);
    }
  }

  return {
    mimeType: match[1],
    bytes: new Uint8Array(output),
  };
}

export function computeRasterPlacement(
  targetWidth: number,
  targetHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  fitMode: "cover" | "contain" | "stretch",
) {
  if (fitMode === "stretch") {
    return {
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(targetWidth)),
      height: Math.max(1, Math.round(targetHeight)),
      scaleMode: "FILL" as const,
    };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;
  const useContain = fitMode === "contain" ? sourceAspect > targetAspect : sourceAspect < targetAspect;

  const width = useContain ? targetWidth : targetHeight * sourceAspect;
  const height = useContain ? targetWidth / sourceAspect : targetHeight;

  return {
    x: Math.round((targetWidth - width) / 2),
    y: Math.round((targetHeight - height) / 2),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    scaleMode: "FILL" as const,
  };
}

export async function tryRunAssetReconstructionCommand(
  command: FigmaCapabilityCommand,
  batchSource: string | undefined,
  deps: AssetCommandDeps,
): Promise<PluginCommandExecutionResult | null> {
  switch (command.capabilityId) {
    case "assets.export-node-image": {
      const payload = command.payload as {
        format?: "PNG";
        constraint?: { type: "WIDTH" | "HEIGHT" | "SCALE"; value: number };
        preferOriginalBytes?: boolean;
      };
      const targets = await deps.getTargetNodes(command, batchSource);
      const exportedImages = [];
      const warnings: string[] = [];

      for (const node of targets) {
        const artifact = await exportNodeImageArtifact(node, {
          preferOriginalBytes: payload.preferOriginalBytes,
          constraint: payload.constraint,
        });
        if (!artifact) {
          warnings.push(`${node.name || node.id} 当前无法导出为图片。`);
          continue;
        }
        exportedImages.push(artifact);
      }

      if (!exportedImages.length) {
        throw new Error(warnings[0] || "没有成功导出任何节点图片。");
      }

      return deps.successResult(command.capabilityId, `已导出 ${exportedImages.length} 个节点图片。`, {
        exportedImages,
        warnings,
      });
    }

    case "reconstruction.apply-raster-reference": {
      const payload = command.payload as {
        referenceNodeId?: string;
        referenceDataUrl?: string;
        resultName?: string;
        replaceTargetContents?: boolean;
        resizeTargetToReference?: boolean;
        fitMode?: "cover" | "contain" | "stretch";
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        opacity?: number;
      };
      if (
        !(typeof payload.referenceNodeId === "string" && payload.referenceNodeId.trim()) &&
        !(typeof payload.referenceDataUrl === "string" && payload.referenceDataUrl.trim())
      ) {
        throw new Error("referenceNodeId 或 referenceDataUrl 至少需要一个。");
      }

      const targets = await deps.getTargetNodes(command, batchSource);
      if (targets.length !== 1) {
        throw new Error("raster reconstruction 需要且只支持一个目标 Frame。");
      }

      const target = targets[0];
      if (target.type !== "FRAME") {
        throw new Error(`raster reconstruction 目标节点必须是 FRAME，当前为 ${target.type}。`);
      }

      const artifact =
        typeof payload.referenceDataUrl === "string" && payload.referenceDataUrl.trim()
          ? (() => {
              const { bytes, mimeType } = decodeDataUrl(payload.referenceDataUrl as string);
              return {
                dataUrl: payload.referenceDataUrl as string,
                bytes,
                mimeType,
                width: Number.isFinite(payload.width) ? Number(payload.width) : target.width,
                height: Number.isFinite(payload.height) ? Number(payload.height) : target.height,
              };
            })()
          : await (async () => {
              const referenceNode = await figma.getNodeByIdAsync(String(payload.referenceNodeId));
              if (!referenceNode) {
                throw new Error(`referenceNodeId "${payload.referenceNodeId}" 未找到。`);
              }
              const exported = await exportNodeImageArtifact(referenceNode, {
                preferOriginalBytes: true,
              });
              if (!exported) {
                throw new Error("参考节点无法导出为图片。");
              }
              return exported;
            })();

      if (payload.replaceTargetContents !== false && supportsChildren(target)) {
        for (const child of [...target.children]) {
          child.remove();
        }
      }

      if (payload.resizeTargetToReference !== false) {
        if (
          typeof artifact.width !== "number" ||
          typeof artifact.height !== "number" ||
          artifact.width <= 0 ||
          artifact.height <= 0
        ) {
          throw new Error("参考图片尺寸无效，无法调整目标 Frame。");
        }
        target.resize(artifact.width, artifact.height);
      }

      const image = figma.createImage(
        "bytes" in artifact && artifact.bytes ? artifact.bytes : decodeDataUrl(artifact.dataUrl).bytes,
      );
      const rasterNode = figma.createRectangle();
      target.appendChild(rasterNode);
      rasterNode.name = payload.resultName?.trim() || "AD Raster";
      const targetWidth = Math.max(1, Math.round(typeof target.width === "number" ? target.width : artifact.width));
      const targetHeight = Math.max(1, Math.round(typeof target.height === "number" ? target.height : artifact.height));
      const hasExplicitBounds =
        Number.isFinite(payload.x) &&
        Number.isFinite(payload.y) &&
        Number.isFinite(payload.width) &&
        Number.isFinite(payload.height);
      const placement = hasExplicitBounds
        ? {
            x: Math.round(Number(payload.x)),
            y: Math.round(Number(payload.y)),
            width: Math.max(1, Math.round(Number(payload.width))),
            height: Math.max(1, Math.round(Number(payload.height))),
            scaleMode: "FILL" as const,
          }
        : computeRasterPlacement(
            targetWidth,
            targetHeight,
            Math.max(1, Number(artifact.width || targetWidth)),
            Math.max(1, Number(artifact.height || targetHeight)),
            payload.fitMode || "cover",
          );

      rasterNode.resize(placement.width, placement.height);
      rasterNode.x = placement.x;
      rasterNode.y = placement.y;
      if ("strokes" in rasterNode) {
        rasterNode.strokes = [];
      }
      if ("cornerRadius" in rasterNode) {
        rasterNode.cornerRadius = 0;
      }
      if ("layoutMode" in target && target.layoutMode !== "NONE" && "layoutPositioning" in rasterNode) {
        rasterNode.layoutPositioning = "ABSOLUTE";
      }
      if ("clipsContent" in target) {
        target.clipsContent = true;
      }
      rasterNode.fills = [
        {
          type: "IMAGE",
          imageHash: image.hash,
          scaleMode: placement.scaleMode,
          visible: true,
          opacity:
            Number.isFinite(payload.opacity) && Number(payload.opacity) >= 0 && Number(payload.opacity) <= 1
              ? Number(payload.opacity)
              : 1,
        },
      ];

      return deps.successResult(command.capabilityId, `已将参考图精确写入目标 Frame "${target.name}"。`, {
        changedNodeIds: [rasterNode.id],
      });
    }

    default:
      return null;
  }
}
