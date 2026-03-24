import type {
  ReconstructionAnalysis,
  ReconstructionBounds,
  ReconstructionDesignSurface,
  ReconstructionFontMatch,
  ReconstructionJob,
  ReconstructionPlan,
  ReconstructionReviewFlag,
  ReconstructionTextBlock,
  ReconstructionTextCandidate,
  ReconstructionVectorPrimitive,
} from "../../shared/reconstruction.js";
import type { FigmaCapabilityCommand } from "../../shared/plugin-contract.js";

function projectBounds(
  bounds: ReconstructionBounds,
  targetWidth: number,
  targetHeight: number,
) {
  return {
    x: Math.round(bounds.x * targetWidth),
    y: Math.round(bounds.y * targetHeight),
    width: Math.max(8, Math.round(bounds.width * targetWidth)),
    height: Math.max(8, Math.round(bounds.height * targetHeight)),
  };
}

function boundsOverlap(left: ReconstructionBounds, right: ReconstructionBounds) {
  const leftEdge = Math.max(left.x, right.x);
  const topEdge = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  if (rightEdge <= leftEdge || bottomEdge <= topEdge) {
    return 0;
  }
  const overlapArea = (rightEdge - leftEdge) * (bottomEdge - topEdge);
  const leftArea = left.width * left.height;
  return leftArea > 0 ? overlapArea / leftArea : 0;
}

export function recommendedTextColor(theme: ReconstructionAnalysis["styleHints"]["theme"]) {
  return theme === "dark" ? "#F5F7FF" : "#111111";
}

function recommendedFontSize(
  role: ReconstructionTextCandidate["estimatedRole"],
  projectedHeight: number,
  targetHeight: number,
) {
  const scale = Math.max(0.9, Math.min(1.15, targetHeight / 874));
  const baseSize =
    role === "metric" ? 32 : role === "headline" ? 24 : role === "body" ? 16 : 14;
  const hardMax =
    role === "metric" ? 40 : role === "headline" ? 28 : 18;
  const bandMax = Math.max(12, Math.floor(projectedHeight * 0.55));
  return Math.max(12, Math.min(Math.round(baseSize * scale), hardMax, bandMax));
}

function buildPreviewOnlyPlan(
  job: ReconstructionJob,
  analysis: ReconstructionAnalysis,
  fontMatches: ReconstructionFontMatch[],
): ReconstructionPlan {
  const targetWidth = job.targetNode.width || analysis.width;
  const targetHeight = job.targetNode.height || analysis.height;
  const parentNodeId = job.targetNode.id;
  const ops = [];
  const namePrefix = `AD Rebuild/${job.id}`;
  let surfaceIndex = 0;
  let textIndex = 0;

  for (const region of analysis.layoutRegions.slice(0, 3)) {
    const projected = projectBounds(region.bounds, targetWidth, targetHeight);
    surfaceIndex += 1;
    ops.push({
      type: "capability",
      capabilityId: "nodes.create-frame",
      payload: {
        name: `${namePrefix}/Surface ${surfaceIndex}`,
        width: projected.width,
        height: projected.height,
        x: projected.x,
        y: projected.y,
        fillHex: region.fillHex || analysis.styleHints.primaryColorHex || "#D9D9D9",
        cornerRadius: analysis.styleHints.cornerRadiusHint,
        parentNodeId,
        analysisRefId: region.id,
      },
    } as const);
  }

  for (const candidate of analysis.textCandidates.slice(0, 4)) {
    const projected = projectBounds(candidate.bounds, targetWidth, targetHeight);
    const match = fontMatches.find((item) => item.textCandidateId === candidate.id);
    const styleHint = analysis.textStyleHints.find((item) => item.textCandidateId === candidate.id);
    const ocrBlock = analysis.ocrBlocks.find(
      (item) => item.bounds.x === candidate.bounds.x && item.bounds.y === candidate.bounds.y,
    );
    textIndex += 1;
    ops.push({
      type: "capability",
      capabilityId: "nodes.create-text",
      payload: {
        name: `${namePrefix}/Text ${textIndex}`,
        content:
          ocrBlock?.text ||
          (candidate.estimatedRole === "metric"
            ? "[metric]"
            : candidate.estimatedRole === "headline"
              ? "[headline]"
              : "[label]"),
        fontFamily: match ? match.recommended : "Inter",
        fontSize:
          styleHint?.fontSizeEstimate ||
          recommendedFontSize(candidate.estimatedRole, projected.height, targetHeight),
        colorHex: styleHint?.colorHex || recommendedTextColor(analysis.styleHints.theme),
        ...(styleHint?.lineHeightEstimate ? { lineHeight: styleHint.lineHeightEstimate } : {}),
        ...(styleHint?.letterSpacingEstimate !== null && styleHint?.letterSpacingEstimate !== undefined
          ? { letterSpacing: styleHint.letterSpacingEstimate }
          : {}),
        ...(styleHint?.alignmentGuess && styleHint.alignmentGuess !== "unknown"
          ? { alignment: styleHint.alignmentGuess }
          : {}),
        x: projected.x,
        y: projected.y,
        parentNodeId,
        analysisRefId: candidate.id,
      },
    } as const);
  }

  return {
    previewOnly: true,
    summary: [
      `识别出 ${analysis.layoutRegions.length} 个主要区块。`,
      `识别出 ${analysis.textCandidates.length} 个疑似文本区域。`,
      `生成 ${ops.length} 条 preview-only rebuild ops。`,
    ],
    ops,
  };
}

function buildVectorReconstructionPlan(
  job: ReconstructionJob,
  analysis: ReconstructionAnalysis,
): ReconstructionPlan {
  const targetWidth = job.targetNode.width || analysis.canonicalFrame?.width || analysis.width;
  const targetHeight = job.targetNode.height || analysis.canonicalFrame?.height || analysis.height;
  const parentNodeId = job.targetNode.id;
  const namePrefix = `AD Vector/${job.id}`;
  const ops: FigmaCapabilityCommand[] = [];
  const surfaceEntries = analysis.designSurfaces.map((surface) => ({
    surface,
    projected: projectBounds(surface.bounds, targetWidth, targetHeight),
  }));
  const surfaceById = new Map(surfaceEntries.map((entry) => [entry.surface.id, entry] as const));

  const batchRef = (analysisRefId: string) => `analysis:${analysisRefId}`;
  const containsPoint = (bounds: ReconstructionBounds, x: number, y: number) =>
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height;
  const normalizedArea = (bounds: ReconstructionBounds) => bounds.width * bounds.height;
  const findOwningSurfaceId = (bounds: ReconstructionBounds) => {
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    return surfaceEntries
      .filter((entry) => containsPoint(entry.surface.bounds, centerX, centerY))
      .sort((left, right) => normalizedArea(left.surface.bounds) - normalizedArea(right.surface.bounds))[0]?.surface.id || null;
  };
  const isPillSurface = (surface: ReconstructionDesignSurface) => /pill/i.test(surface.name || surface.id);
  const isSavePillSurface = (surface: ReconstructionDesignSurface) =>
    /save/i.test(surface.name || surface.id);
  const isWalkPillSurface = (surface: ReconstructionDesignSurface) =>
    /walk/i.test(surface.name || surface.id);
  const surfaceLayerName = (surface: ReconstructionDesignSurface) =>
    `${namePrefix}/Surface/${isPillSurface(surface) ? "Action" : "Card"}/${surface.name || surface.id}`;
  const textLayerName = (block: ReconstructionTextBlock) => {
    const role =
      block.role === "metric"
        ? "Metric"
        : block.role === "headline"
          ? "Headline"
          : block.role === "label"
            ? "Label"
            : "Text";
    const label = (block.content || block.id).replace(/\s+/g, " ").trim().slice(0, 48) || block.id;
    return `${namePrefix}/Text/${role}/${label}`;
  };
  const primitiveLayerName = (primitive: ReconstructionVectorPrimitive) =>
    `${namePrefix}/Primitive/${primitive.name || primitive.id}`;
  const localPositionForParent = (
    projected: { x: number; y: number; width: number; height: number },
    ownerSurfaceId: string | null,
  ) => {
    if (!ownerSurfaceId) {
      return {
        parentNodeId,
        x: projected.x,
        y: projected.y,
        insideAutoLayout: false,
      };
    }

    const owner = surfaceById.get(ownerSurfaceId);
    if (!owner) {
      return {
        parentNodeId,
        x: projected.x,
        y: projected.y,
        insideAutoLayout: false,
      };
    }

    const insideAutoLayout = isPillSurface(owner.surface);
    return {
      parentNodeId: batchRef(ownerSurfaceId),
      ...(insideAutoLayout
        ? {}
        : {
            x: projected.x - owner.projected.x,
            y: projected.y - owner.projected.y,
          }),
      insideAutoLayout,
    };
  };

  for (const entry of surfaceEntries) {
    ops.push({
      type: "capability",
      capabilityId: "nodes.create-frame",
      payload: {
        name: surfaceLayerName(entry.surface),
        width: entry.projected.width,
        height: entry.projected.height,
        x: entry.projected.x,
        y: entry.projected.y,
        fillHex: entry.surface.fillHex || analysis.styleHints.primaryColorHex || "#D9D9D9",
        cornerRadius: entry.surface.cornerRadius ?? analysis.styleHints.cornerRadiusHint,
        parentNodeId,
        analysisRefId: entry.surface.id,
      },
    } as FigmaCapabilityCommand);

    const layoutPayload = isSavePillSurface(entry.surface)
      ? {
          layoutMode: "VERTICAL" as const,
          primaryAxisSizingMode: "FIXED" as const,
          counterAxisSizingMode: "FIXED" as const,
          primaryAxisAlignItems: "CENTER" as const,
          counterAxisAlignItems: "CENTER" as const,
          clipsContent: true,
        }
      : isWalkPillSurface(entry.surface)
        ? {
            layoutMode: "HORIZONTAL" as const,
            primaryAxisSizingMode: "FIXED" as const,
            counterAxisSizingMode: "FIXED" as const,
            primaryAxisAlignItems: "CENTER" as const,
            counterAxisAlignItems: "CENTER" as const,
            paddingTop: 18,
            paddingRight: 18,
            paddingBottom: 18,
            paddingLeft: 18,
            clipsContent: true,
          }
        : {
            layoutMode: "NONE" as const,
            clipsContent: true,
          };

    ops.push({
      type: "capability",
      capabilityId: "layout.configure-frame",
      nodeIds: [batchRef(entry.surface.id)],
      payload: layoutPayload,
    } as FigmaCapabilityCommand);
  }

  for (const primitive of analysis.vectorPrimitives) {
    if (primitive.kind === "svg" && primitive.svgMarkup) {
      const projected = primitive.bounds
        ? projectBounds(primitive.bounds, targetWidth, targetHeight)
        : null;
      const ownerSurfaceId = primitive.bounds ? findOwningSurfaceId(primitive.bounds) : null;
      const placement = projected
        ? localPositionForParent(projected, ownerSurfaceId)
        : { parentNodeId, insideAutoLayout: false };
      ops.push({
        type: "capability",
        capabilityId: "nodes.create-svg",
        payload: {
          name: primitiveLayerName(primitive),
          svgMarkup: primitive.svgMarkup,
          ...(projected
            ? {
                ...(placement.insideAutoLayout ? {} : { x: placement.x, y: placement.y }),
                width: projected.width,
                height: projected.height,
              }
            : {}),
          ...(primitive.opacity !== null ? { opacity: primitive.opacity } : {}),
          parentNodeId: placement.parentNodeId,
          analysisRefId: primitive.id,
        },
      } as FigmaCapabilityCommand);
      continue;
    }

    if (!primitive.bounds) {
      continue;
    }

    const projected =
      primitive.kind === "line"
        ? {
            x: Math.round(primitive.bounds.x * targetWidth),
            y: Math.round(primitive.bounds.y * targetHeight),
            width: Math.max(1, Math.round(primitive.bounds.width * targetWidth)),
            height: Math.max(1, Math.round(primitive.bounds.height * targetHeight)),
          }
        : projectBounds(primitive.bounds, targetWidth, targetHeight);
    const ownerSurfaceId = findOwningSurfaceId(primitive.bounds);
    const placement = localPositionForParent(projected, ownerSurfaceId);

    if (primitive.kind === "ellipse") {
      ops.push({
        type: "capability",
        capabilityId: "nodes.create-ellipse",
        payload: {
          name: primitiveLayerName(primitive),
          width: projected.width,
          height: projected.height,
          ...(placement.insideAutoLayout ? {} : { x: placement.x, y: placement.y }),
          fillHex: primitive.fillHex || undefined,
          strokeHex: primitive.strokeHex || undefined,
          strokeWeight: primitive.strokeWeight ?? undefined,
          opacity: primitive.opacity ?? undefined,
          parentNodeId: placement.parentNodeId,
          analysisRefId: primitive.id,
        },
      } as FigmaCapabilityCommand);
      continue;
    }

    if (primitive.kind === "line") {
      ops.push({
        type: "capability",
        capabilityId: "nodes.create-line",
        payload: {
          name: primitiveLayerName(primitive),
          width: projected.width,
          height: projected.height,
          ...(placement.insideAutoLayout ? {} : { x: placement.x, y: placement.y }),
          strokeHex: primitive.strokeHex || primitive.fillHex || "#000000",
          strokeWeight: primitive.strokeWeight ?? 1,
          opacity: primitive.opacity ?? undefined,
          parentNodeId: placement.parentNodeId,
          analysisRefId: primitive.id,
        },
      } as FigmaCapabilityCommand);
      continue;
    }

    ops.push({
      type: "capability",
      capabilityId: "nodes.create-rectangle",
      payload: {
        name: primitiveLayerName(primitive),
        width: projected.width,
        height: projected.height,
        ...(placement.insideAutoLayout ? {} : { x: placement.x, y: placement.y }),
        fillHex: primitive.fillHex || undefined,
        strokeHex: primitive.strokeHex || undefined,
        strokeWeight: primitive.strokeWeight ?? undefined,
        opacity: primitive.opacity ?? undefined,
        cornerRadius: primitive.cornerRadius ?? undefined,
        parentNodeId: placement.parentNodeId,
        analysisRefId: primitive.id,
      },
    } as FigmaCapabilityCommand);
  }

  for (const block of analysis.textBlocks) {
    const projected = projectBounds(block.bounds, targetWidth, targetHeight);
    const ownerSurfaceId = findOwningSurfaceId(block.bounds);
    const placement = localPositionForParent(projected, ownerSurfaceId);
    ops.push({
      type: "capability",
      capabilityId: "nodes.create-text",
      payload: {
        name: textLayerName(block),
        content: block.content,
        fontFamily: block.fontFamily,
        ...(block.fontStyle ? { fontStyle: block.fontStyle } : {}),
        ...(block.fontWeight !== null ? { fontWeight: block.fontWeight } : {}),
        fontSize: block.fontSize,
        colorHex: block.colorHex || recommendedTextColor(analysis.styleHints.theme),
        ...(block.lineHeight !== null ? { lineHeight: block.lineHeight } : {}),
        ...(block.letterSpacing !== null ? { letterSpacing: block.letterSpacing } : {}),
        alignment: placement.insideAutoLayout ? "center" : block.alignment,
        ...(placement.insideAutoLayout ? {} : { x: placement.x, y: placement.y }),
        parentNodeId: placement.parentNodeId,
        analysisRefId: block.id,
      },
    } as FigmaCapabilityCommand);
  }

  return {
    previewOnly: false,
    summary: [
      `固定 frame: ${targetWidth} x ${targetHeight}。`,
      `矢量容器 ${analysis.designSurfaces.length} 个，图元 ${analysis.vectorPrimitives.length} 个，文本 ${analysis.textBlocks.length} 个。`,
      `生成 ${ops.length} 条 vector rebuild ops。`,
    ],
    ops,
  };
}

function buildHybridReconstructionPlan(
  job: ReconstructionJob,
  analysis: ReconstructionAnalysis,
): ReconstructionPlan {
  const targetWidth = job.targetNode.width || analysis.canonicalFrame?.width || analysis.width;
  const targetHeight = job.targetNode.height || analysis.canonicalFrame?.height || analysis.height;
  const parentNodeId = job.targetNode.id;
  const namePrefix = `AD Hybrid/${job.id}`;
  const fitMode =
    analysis.canonicalFrame?.mappingMode === "center"
      ? "contain"
      : analysis.canonicalFrame?.mappingMode === "reflow"
        ? "stretch"
        : "cover";
  const ops: FigmaCapabilityCommand[] = [
    {
      type: "capability",
      capabilityId: "reconstruction.apply-raster-reference",
      payload: {
        referenceNodeId: job.referenceNode.id,
        resultName: `${namePrefix}/RasterBase`,
        replaceTargetContents: true,
        resizeTargetToReference: false,
        fitMode,
        x: 0,
        y: 0,
        width: targetWidth,
        height: targetHeight,
      },
    } as FigmaCapabilityCommand,
  ];

  for (const primitive of analysis.vectorPrimitives) {
    if (primitive.kind === "svg" && primitive.svgMarkup) {
      const projected = primitive.bounds
        ? projectBounds(primitive.bounds, targetWidth, targetHeight)
        : null;
      ops.push({
        type: "capability",
        capabilityId: "nodes.create-svg",
        payload: {
          name: `${namePrefix}/Overlay/${primitive.id}`,
          svgMarkup: primitive.svgMarkup,
          ...(projected ? { x: projected.x, y: projected.y, width: projected.width, height: projected.height } : {}),
          ...(primitive.opacity !== null ? { opacity: primitive.opacity } : {}),
          parentNodeId,
          analysisRefId: primitive.id,
        },
      } as FigmaCapabilityCommand);
      continue;
    }

    if (!primitive.bounds) {
      continue;
    }

    const projected = projectBounds(primitive.bounds, targetWidth, targetHeight);
    if (primitive.kind === "ellipse") {
      ops.push({
        type: "capability",
        capabilityId: "nodes.create-ellipse",
        payload: {
          name: `${namePrefix}/Overlay/${primitive.id}`,
          width: projected.width,
          height: projected.height,
          x: projected.x,
          y: projected.y,
          fillHex: primitive.fillHex || undefined,
          strokeHex: primitive.strokeHex || undefined,
          strokeWeight: primitive.strokeWeight ?? undefined,
          opacity: primitive.opacity ?? undefined,
          parentNodeId,
          analysisRefId: primitive.id,
        },
      } as FigmaCapabilityCommand);
      continue;
    }
    if (primitive.kind === "line") {
      ops.push({
        type: "capability",
        capabilityId: "nodes.create-line",
        payload: {
          name: `${namePrefix}/Overlay/${primitive.id}`,
          width: Math.max(1, projected.width),
          height: Math.max(1, projected.height),
          x: projected.x,
          y: projected.y,
          strokeHex: primitive.strokeHex || primitive.fillHex || "#000000",
          strokeWeight: primitive.strokeWeight ?? 1,
          opacity: primitive.opacity ?? undefined,
          parentNodeId,
          analysisRefId: primitive.id,
        },
      } as FigmaCapabilityCommand);
      continue;
    }
    ops.push({
      type: "capability",
      capabilityId: "nodes.create-rectangle",
      payload: {
        name: `${namePrefix}/Overlay/${primitive.id}`,
        width: projected.width,
        height: projected.height,
        x: projected.x,
        y: projected.y,
        fillHex: primitive.fillHex || undefined,
        strokeHex: primitive.strokeHex || undefined,
        strokeWeight: primitive.strokeWeight ?? undefined,
        opacity: primitive.opacity ?? undefined,
        cornerRadius: primitive.cornerRadius ?? undefined,
        parentNodeId,
        analysisRefId: primitive.id,
      },
    } as FigmaCapabilityCommand);
  }

  for (const block of analysis.textBlocks) {
    const projected = projectBounds(block.bounds, targetWidth, targetHeight);
    ops.push({
      type: "capability",
      capabilityId: "nodes.create-text",
      payload: {
        name: `${namePrefix}/OverlayText/${block.id}`,
        content: block.content,
        fontFamily: block.fontFamily,
        ...(block.fontStyle ? { fontStyle: block.fontStyle } : {}),
        ...(block.fontWeight !== null ? { fontWeight: block.fontWeight } : {}),
        fontSize: block.fontSize,
        colorHex: block.colorHex || recommendedTextColor(analysis.styleHints.theme),
        ...(block.lineHeight !== null ? { lineHeight: block.lineHeight } : {}),
        ...(block.letterSpacing !== null ? { letterSpacing: block.letterSpacing } : {}),
        alignment: block.alignment,
        x: projected.x,
        y: projected.y,
        parentNodeId,
        analysisRefId: block.id,
      },
    } as FigmaCapabilityCommand);
  }

  return {
    previewOnly: false,
    summary: [
      `固定 frame: ${targetWidth} x ${targetHeight}。`,
      `首层写入 raster base，mapping=${analysis.canonicalFrame?.mappingMode || "extend"} -> fitMode=${fitMode}。`,
      `覆盖层包含图元 ${analysis.vectorPrimitives.length} 个，文本 ${analysis.textBlocks.length} 个。`,
      `生成 ${ops.length} 条 hybrid rebuild ops。`,
    ],
    ops,
  };
}

export function buildReconstructionPlan(
  job: ReconstructionJob,
  analysis: ReconstructionAnalysis,
  fontMatches: ReconstructionFontMatch[],
): ReconstructionPlan {
  if (job.input.strategy === "vector-reconstruction") {
    return buildVectorReconstructionPlan(job, analysis);
  }
  if (job.input.strategy === "hybrid-reconstruction") {
    return buildHybridReconstructionPlan(job, analysis);
  }
  return buildPreviewOnlyPlan(job, analysis, fontMatches);
}

export function buildReconstructionReviewFlags(
  job: ReconstructionJob,
  analysis: ReconstructionAnalysis,
  fontMatches: ReconstructionFontMatch[],
): ReconstructionReviewFlag[] {
  const flags: ReconstructionReviewFlag[] = [
    {
      id: "preview-plan-review",
      kind: "preview-plan-review",
      severity: "info",
      message: "preview-plan 已生成；在 apply 前请先完成人工确认或显式 approve。",
      targetId: null,
    },
  ];

  if (!analysis.ocrBlocks.length || analysis.ocrBlocks.every((block) => !block.text)) {
    flags.push({
      id: "ocr-missing",
      kind: "ocr-missing",
      severity: "warning",
      message: "当前分析结果不包含真实 OCR 文本内容，文本仍需人工确认。",
      targetId: null,
    });
  }

  for (const block of analysis.ocrBlocks) {
    if (block.confidence < 0.65) {
      flags.push({
        id: `ocr-low-confidence-${block.id}`,
        kind: "ocr-low-confidence",
        severity: "warning",
        message: `文本区域 ${block.id} 识别置信度较低，需要人工确认。`,
        targetId: block.id,
      });
    }
  }

  for (const match of fontMatches) {
    if (match.confidence < 0.78) {
      flags.push({
        id: `font-review-${match.textCandidateId}`,
        kind: "font-review",
        severity: "warning",
        message: `文本区域 ${match.textCandidateId} 的字体匹配置信度较低，需要确认字体。`,
        targetId: match.textCandidateId,
      });
    }
  }

  if (job.input.allowOutpainting) {
    flags.push({
      id: "outpainting-not-supported",
      kind: "outpainting-not-supported",
      severity: "critical",
      message: "allowOutpainting 已记录，但当前实现仍不会自动生成补图素材。",
      targetId: null,
    });
  }

  for (const asset of analysis.assetCandidates) {
    if (asset.needsOutpainting || asset.confidence < 0.72) {
      flags.push({
        id: `asset-review-${asset.id}`,
        kind: "asset-review",
        severity: asset.needsOutpainting ? "critical" : "warning",
        message: `素材区域 ${asset.id} 需要人工确认后再进入资产写回。`,
        targetId: asset.id,
      });
    }
  }

  return flags;
}

export function synthesizeSemanticNodes(
  analysis: Pick<
    ReconstructionAnalysis,
    "designSurfaces" | "textBlocks" | "vectorPrimitives" | "styleHints"
  >,
) {
  const nodes = [
    {
      id: "semantic-screen-root",
      name: "Screen Root",
      kind: "screen-root",
      parentId: null,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      inferred: false,
      surfaceRefId: null,
      textRefId: null,
      primitiveRefId: null,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      fillHex: analysis.styleHints.primaryColorHex,
      cornerRadius: 0,
      componentName: null,
    },
  ] as ReconstructionAnalysis["semanticNodes"];

  for (const surface of analysis.designSurfaces) {
    nodes.push({
      id: `semantic-${surface.id}`,
      name: surface.name || surface.id,
      kind: /pill/i.test(surface.name || surface.id)
        ? "pill"
        : /card/i.test(surface.name || surface.id)
          ? "card"
          : "section",
      parentId: "semantic-screen-root",
      bounds: surface.bounds,
      inferred: surface.inferred,
      surfaceRefId: surface.id,
      textRefId: null,
      primitiveRefId: null,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      fillHex: surface.fillHex,
      cornerRadius: surface.cornerRadius,
      componentName: /pill/i.test(surface.name || surface.id) ? "ActionPill" : null,
    });
  }

  for (const block of analysis.textBlocks) {
    const parentSurface = analysis.designSurfaces.find(
      (surface) => boundsOverlap(surface.bounds, block.bounds) > 0.45,
    );
    nodes.push({
      id: `semantic-${block.id}`,
      name: block.content.slice(0, 32) || block.id,
      kind: /^Wednesday/i.test(block.content) ? "header" : "text",
      parentId: parentSurface ? `semantic-${parentSurface.id}` : "semantic-screen-root",
      bounds: block.bounds,
      inferred: block.inferred,
      surfaceRefId: null,
      textRefId: block.id,
      primitiveRefId: null,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: null,
      paddingRight: null,
      paddingBottom: null,
      paddingLeft: null,
      fillHex: block.colorHex,
      cornerRadius: null,
      componentName: null,
    });
  }

  return nodes;
}
