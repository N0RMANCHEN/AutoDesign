import { execFile } from "node:child_process";
import { writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ReconstructionContextPack,
  ReconstructionAnalysisProvider,
  ReconstructionAnalysis,
  ReconstructionAssetCandidate,
  ReconstructionBounds,
  ReconstructionCanonicalFrame,
  ReconstructionCompletionZone,
  ReconstructionCompletionSuggestion,
  ReconstructionDeprojectionNote,
  ReconstructionDesignTokens,
  ReconstructionDesignSurface,
  ReconstructionFontMatch,
  ReconstructionJob,
  ReconstructionOcrBlock,
  ReconstructionPlan,
  ReconstructionPoint,
  ReconstructionRegion,
  ReconstructionReviewFlag,
  ReconstructionScreenPlane,
  ReconstructionSemanticNode,
  ReconstructionTextCandidate,
  ReconstructionTextBlock,
  ReconstructionTextStyleHint,
  ReconstructionVectorPrimitive,
} from "../shared/reconstruction.js";
import type { FigmaCapabilityCommand } from "../shared/plugin-contract.js";

const RECONSTRUCTION_ANALYSIS_VERSION = "2026-03-22-preview-v2";
export const RECONSTRUCTION_ANALYSIS_VERSION_CODEX = "2026-03-22-codex-assisted-v1";

const execFileAsync = promisify(execFile);

function parsePreviewDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("参考图 previewDataUrl 格式无效。");
  }

  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], "base64"),
  };
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/gif":
      return ".gif";
    default:
      return ".img";
  }
}

function normalizeColorList(colors: unknown) {
  if (!Array.isArray(colors)) {
    return [];
  }

  return colors
    .map((item) => (typeof item === "string" ? item.trim().toUpperCase() : ""))
    .filter(Boolean)
    .slice(0, 6);
}

function normalizePoints(input: unknown): ReconstructionPoint[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => ({
      x: Number.isFinite((item as any)?.x) ? Number((item as any).x) : 0,
      y: Number.isFinite((item as any)?.y) ? Number((item as any).y) : 0,
    }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice(0, 16);
}

function normalizeBounds(input: any): ReconstructionBounds {
  return {
    x: Number.isFinite(input?.x) ? Number(input.x) : 0,
    y: Number.isFinite(input?.y) ? Number(input.y) : 0,
    width: Number.isFinite(input?.width) ? Number(input.width) : 0,
    height: Number.isFinite(input?.height) ? Number(input.height) : 0,
  };
}

function normalizeRegions(input: unknown): ReconstructionRegion[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof item?.id === "string" ? item.id : `surface-${index + 1}`,
      kind:
        item?.kind === "surface" ||
        item?.kind === "text-band" ||
        item?.kind === "emphasis" ||
        item?.kind === "unknown"
          ? item.kind
          : "unknown",
      confidence: Number.isFinite(item?.confidence) ? Number(item.confidence) : 0.4,
      bounds: normalizeBounds(item?.bounds),
      fillHex: typeof item?.fillHex === "string" ? item.fillHex.toUpperCase() : null,
    }))
    .filter((item) => item.bounds.width > 0 && item.bounds.height > 0)
    .slice(0, 12);
}

function normalizeTextCandidates(input: unknown): ReconstructionTextCandidate[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof item?.id === "string" ? item.id : `text-${index + 1}`,
      confidence: Number.isFinite(item?.confidence) ? Number(item.confidence) : 0.4,
      bounds: normalizeBounds(item?.bounds),
      estimatedRole:
        item?.estimatedRole === "headline" ||
        item?.estimatedRole === "body" ||
        item?.estimatedRole === "metric" ||
        item?.estimatedRole === "label" ||
        item?.estimatedRole === "unknown"
          ? item.estimatedRole
          : "unknown",
    }))
    .filter((item) => item.bounds.width > 0 && item.bounds.height > 0)
    .slice(0, 12);
}

function normalizeOcrBlocks(input: unknown): ReconstructionOcrBlock[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof item?.id === "string" ? item.id : `ocr-${index + 1}`,
      text: typeof item?.text === "string" && item.text.trim() ? item.text.trim() : null,
      confidence: Number.isFinite(item?.confidence) ? Number(item.confidence) : 0.35,
      bounds: normalizeBounds(item?.bounds),
      lineCount:
        Number.isFinite(item?.lineCount) && Number(item.lineCount) > 0
          ? Math.floor(Number(item.lineCount))
          : 1,
      language: typeof item?.language === "string" && item.language.trim() ? item.language.trim() : null,
      source: item?.source === "ocr" ? ("ocr" as const) : ("heuristic" as const),
    }))
    .filter((item) => item.bounds.width > 0 && item.bounds.height > 0)
    .slice(0, 12);
}

function normalizeTextStyleHints(input: unknown): ReconstructionTextStyleHint[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => ({
      textCandidateId: typeof item?.textCandidateId === "string" ? item.textCandidateId : "",
      role:
        item?.role === "headline" ||
        item?.role === "body" ||
        item?.role === "metric" ||
        item?.role === "label" ||
        item?.role === "unknown"
          ? item.role
          : "unknown",
      fontCategory:
        item?.fontCategory === "display" ||
        item?.fontCategory === "text" ||
        item?.fontCategory === "mono" ||
        item?.fontCategory === "unknown"
          ? item.fontCategory
          : "unknown",
      fontWeightGuess: Number.isFinite(item?.fontWeightGuess) ? Number(item.fontWeightGuess) : null,
      fontSizeEstimate: Number.isFinite(item?.fontSizeEstimate) ? Number(item.fontSizeEstimate) : null,
      colorHex: typeof item?.colorHex === "string" ? item.colorHex.toUpperCase() : null,
      alignmentGuess:
        item?.alignmentGuess === "left" ||
        item?.alignmentGuess === "center" ||
        item?.alignmentGuess === "right" ||
        item?.alignmentGuess === "justified" ||
        item?.alignmentGuess === "unknown"
          ? item.alignmentGuess
          : "unknown",
      lineHeightEstimate: Number.isFinite(item?.lineHeightEstimate)
        ? Number(item.lineHeightEstimate)
        : null,
      letterSpacingEstimate: Number.isFinite(item?.letterSpacingEstimate)
        ? Number(item.letterSpacingEstimate)
        : null,
      confidence: Number.isFinite(item?.confidence) ? Number(item.confidence) : 0.4,
    }))
    .filter((item) => item.textCandidateId)
    .slice(0, 12);
}

function normalizeAssetCandidates(input: unknown): ReconstructionAssetCandidate[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof item?.id === "string" ? item.id : `asset-${index + 1}`,
      kind:
        item?.kind === "photo" ||
        item?.kind === "illustration" ||
        item?.kind === "icon-like" ||
        item?.kind === "texture" ||
        item?.kind === "background-slice"
          ? item.kind
          : "background-slice",
      bounds: normalizeBounds(item?.bounds),
      confidence: Number.isFinite(item?.confidence) ? Number(item.confidence) : 0.35,
      extractMode:
        item?.extractMode === "crop" ||
        item?.extractMode === "trace" ||
        item?.extractMode === "outpaint" ||
        item?.extractMode === "ignore"
          ? item.extractMode
          : "ignore",
      needsOutpainting: Boolean(item?.needsOutpainting),
    }))
    .filter((item) => item.bounds.width > 0 && item.bounds.height > 0)
    .slice(0, 12);
}

function normalizeFontMatches(
  input: unknown,
  textCandidates: ReconstructionTextCandidate[],
): ReconstructionFontMatch[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const validTextCandidateIds = new Set(textCandidates.map((candidate) => candidate.id));
  return input
    .map((item) => ({
      textCandidateId:
        typeof item?.textCandidateId === "string" ? item.textCandidateId.trim() : "",
      recommended:
        typeof item?.recommended === "string" && item.recommended.trim()
          ? item.recommended.trim()
          : "Inter",
      candidates: Array.isArray(item?.candidates)
        ? item.candidates
            .map((candidate: unknown) => (typeof candidate === "string" ? candidate.trim() : ""))
            .filter(Boolean)
            .slice(0, 5)
        : [],
      confidence: Number.isFinite(item?.confidence) ? Number(item.confidence) : 0.5,
    }))
    .filter((item) => item.textCandidateId && validTextCandidateIds.has(item.textCandidateId))
    .map((item) => ({
      ...item,
      candidates: uniqueStrings([item.recommended, ...item.candidates]).slice(0, 5),
    }));
}

function normalizeReviewFlags(input: unknown): ReconstructionReviewFlag[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => ({
      id: typeof item?.id === "string" && item.id.trim() ? item.id.trim() : "",
      kind:
        item?.kind === "ocr-missing" ||
        item?.kind === "ocr-low-confidence" ||
        item?.kind === "font-review" ||
        item?.kind === "asset-review" ||
        item?.kind === "outpainting-not-supported" ||
        item?.kind === "preview-plan-review"
          ? item.kind
          : "preview-plan-review",
      severity:
        item?.severity === "info" || item?.severity === "warning" || item?.severity === "critical"
          ? item.severity
          : "warning",
      message: typeof item?.message === "string" ? item.message.trim() : "",
      targetId: typeof item?.targetId === "string" && item.targetId.trim() ? item.targetId.trim() : null,
    }))
    .filter((item) => item.id && item.message);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueNumbers(values: Array<number | null | undefined>) {
  return [...new Set(values.filter((value): value is number => Number.isFinite(value)).map(Number))];
}

function boundsOverlap(
  left: ReconstructionBounds,
  right: ReconstructionBounds,
) {
  const leftRight = left.x + left.width;
  const leftBottom = left.y + left.height;
  const rightRight = right.x + right.width;
  const rightBottom = right.y + right.height;
  const overlapWidth = Math.max(0, Math.min(leftRight, rightRight) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(leftBottom, rightBottom) - Math.max(left.y, right.y));
  const overlapArea = overlapWidth * overlapHeight;
  const leftArea = Math.max(0.0001, left.width * left.height);
  const rightArea = Math.max(0.0001, right.width * right.height);
  return overlapArea / Math.min(leftArea, rightArea);
}

function normalizeStyleHints(input: any, dominantColors: string[]) {
  const primary = typeof input?.primaryColorHex === "string" ? input.primaryColorHex.toUpperCase() : null;
  const accent = typeof input?.accentColorHex === "string" ? input.accentColorHex.toUpperCase() : null;
  const theme: "light" | "dark" = input?.theme === "light" ? "light" : "dark";
  const shadowHint: "none" | "soft" = input?.shadowHint === "soft" ? "soft" : "none";

  return {
    theme,
    cornerRadiusHint:
      Number.isFinite(input?.cornerRadiusHint) && Number(input.cornerRadiusHint) >= 0
        ? Number(input.cornerRadiusHint)
        : 20,
    shadowHint,
    primaryColorHex: primary || dominantColors[0] || null,
    accentColorHex: accent || dominantColors[1] || dominantColors[0] || null,
  };
}

function normalizeCanonicalFrame(
  input: any,
  job: ReconstructionJob,
  rawWidth: number,
  rawHeight: number,
): ReconstructionCanonicalFrame {
  const targetWidth = Number(job.targetNode.width || rawWidth || 0);
  const targetHeight = Number(job.targetNode.height || rawHeight || 0);
  const sourceQuad = normalizePoints(input?.sourceQuad).slice(0, 4);
  return {
    width:
      Number.isFinite(input?.width) && Number(input.width) > 0
        ? Number(input.width)
        : targetWidth,
    height:
      Number.isFinite(input?.height) && Number(input.height) > 0
        ? Number(input.height)
        : targetHeight,
    fixedTargetFrame: input?.fixedTargetFrame !== false,
    deprojected: input?.deprojected !== false,
    mappingMode:
      input?.mappingMode === "reflow"
        ? "reflow"
        : input?.mappingMode === "center"
          ? "center"
          : "extend",
    ...(sourceQuad.length === 4 ? { sourceQuad } : {}),
  };
}

function normalizeScreenPlane(input: unknown): ReconstructionScreenPlane | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const rectifiedPreviewDataUrl =
    typeof (input as any)?.rectifiedPreviewDataUrl === "string" &&
    (input as any).rectifiedPreviewDataUrl.startsWith("data:image/")
      ? (input as any).rectifiedPreviewDataUrl
      : null;
  const sourceQuad = normalizePoints((input as any)?.sourceQuad).slice(0, 4);
  return {
    extracted: (input as any)?.extracted !== false,
    excludesNonUiShell: (input as any)?.excludesNonUiShell !== false,
    confidence: Number.isFinite((input as any)?.confidence) ? Number((input as any).confidence) : 0.5,
    sourceQuad,
    rectifiedPreviewDataUrl,
  };
}

function normalizeDesignSurfaces(input: unknown): ReconstructionDesignSurface[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof (item as any)?.id === "string" ? (item as any).id : `surface-${index + 1}`,
      name:
        typeof (item as any)?.name === "string" && (item as any).name.trim()
          ? (item as any).name.trim()
          : null,
      bounds: normalizeBounds((item as any)?.bounds),
      fillHex:
        typeof (item as any)?.fillHex === "string" ? (item as any).fillHex.toUpperCase() : null,
      cornerRadius:
        Number.isFinite((item as any)?.cornerRadius) ? Number((item as any).cornerRadius) : null,
      opacity: Number.isFinite((item as any)?.opacity) ? Number((item as any).opacity) : null,
      shadow:
        (item as any)?.shadow === "soft"
          ? ("soft" as const)
          : (item as any)?.shadow === "none"
            ? ("none" as const)
            : null,
      inferred: Boolean((item as any)?.inferred),
    }))
    .filter((item) => item.bounds.width > 0 && item.bounds.height > 0)
    .slice(0, 20);
}

function normalizeVectorPrimitives(input: unknown): ReconstructionVectorPrimitive[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof (item as any)?.id === "string" ? (item as any).id : `vector-${index + 1}`,
      kind:
        (item as any)?.kind === "ellipse" ||
        (item as any)?.kind === "line" ||
        (item as any)?.kind === "svg"
          ? (item as any).kind
          : "rectangle",
      name:
        typeof (item as any)?.name === "string" && (item as any).name.trim()
          ? (item as any).name.trim()
          : null,
      bounds:
        (item as any)?.bounds &&
        (Number.isFinite((item as any)?.bounds?.width) || Number.isFinite((item as any)?.bounds?.height))
          ? normalizeBounds((item as any).bounds)
          : null,
      points: normalizePoints((item as any)?.points),
      fillHex:
        typeof (item as any)?.fillHex === "string" ? (item as any).fillHex.toUpperCase() : null,
      strokeHex:
        typeof (item as any)?.strokeHex === "string" ? (item as any).strokeHex.toUpperCase() : null,
      strokeWeight:
        Number.isFinite((item as any)?.strokeWeight) ? Number((item as any).strokeWeight) : null,
      opacity: Number.isFinite((item as any)?.opacity) ? Number((item as any).opacity) : null,
      cornerRadius:
        Number.isFinite((item as any)?.cornerRadius) ? Number((item as any).cornerRadius) : null,
      svgMarkup:
        typeof (item as any)?.svgMarkup === "string" && (item as any).svgMarkup.trim()
          ? (item as any).svgMarkup.trim()
          : null,
      inferred: Boolean((item as any)?.inferred),
    }))
    .filter((item) => item.kind === "svg" ? Boolean(item.svgMarkup) : item.bounds !== null || item.points.length > 0)
    .slice(0, 80);
}

function normalizeSemanticNodes(input: unknown): ReconstructionSemanticNode[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof (item as any)?.id === "string" ? (item as any).id : `semantic-${index + 1}`,
      name:
        typeof (item as any)?.name === "string" && (item as any).name.trim()
          ? (item as any).name.trim()
          : `Semantic ${index + 1}`,
      kind:
        (item as any)?.kind === "screen-root" ||
        (item as any)?.kind === "header" ||
        (item as any)?.kind === "section" ||
        (item as any)?.kind === "card" ||
        (item as any)?.kind === "pill" ||
        (item as any)?.kind === "group" ||
        (item as any)?.kind === "text" ||
        (item as any)?.kind === "primitive"
          ? (item as any).kind
          : "group",
      parentId:
        typeof (item as any)?.parentId === "string" && (item as any).parentId.trim()
          ? (item as any).parentId.trim()
          : null,
      bounds: normalizeBounds((item as any)?.bounds),
      inferred: Boolean((item as any)?.inferred),
      surfaceRefId:
        typeof (item as any)?.surfaceRefId === "string" && (item as any).surfaceRefId.trim()
          ? (item as any).surfaceRefId.trim()
          : null,
      textRefId:
        typeof (item as any)?.textRefId === "string" && (item as any).textRefId.trim()
          ? (item as any).textRefId.trim()
          : null,
      primitiveRefId:
        typeof (item as any)?.primitiveRefId === "string" && (item as any).primitiveRefId.trim()
          ? (item as any).primitiveRefId.trim()
          : null,
      layoutMode:
        (item as any)?.layoutMode === "HORIZONTAL" || (item as any)?.layoutMode === "VERTICAL"
          ? (item as any).layoutMode
          : "NONE",
      itemSpacing: Number.isFinite((item as any)?.itemSpacing) ? Number((item as any).itemSpacing) : null,
      paddingTop: Number.isFinite((item as any)?.paddingTop) ? Number((item as any).paddingTop) : null,
      paddingRight: Number.isFinite((item as any)?.paddingRight) ? Number((item as any).paddingRight) : null,
      paddingBottom: Number.isFinite((item as any)?.paddingBottom) ? Number((item as any).paddingBottom) : null,
      paddingLeft: Number.isFinite((item as any)?.paddingLeft) ? Number((item as any).paddingLeft) : null,
      fillHex:
        typeof (item as any)?.fillHex === "string" ? (item as any).fillHex.toUpperCase() : null,
      cornerRadius:
        Number.isFinite((item as any)?.cornerRadius) ? Number((item as any).cornerRadius) : null,
      componentName:
        typeof (item as any)?.componentName === "string" && (item as any).componentName.trim()
          ? (item as any).componentName.trim()
          : null,
    }))
    .filter((item) => item.bounds.width > 0 && item.bounds.height > 0)
    .slice(0, 80);
}

function normalizeDesignTokens(input: unknown): ReconstructionDesignTokens | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const typography = (input as any)?.typography || {};
  const colors = (input as any)?.colors || {};
  return {
    colors: {
      canvas: typeof colors.canvas === "string" ? colors.canvas.toUpperCase() : null,
      accent: typeof colors.accent === "string" ? colors.accent.toUpperCase() : null,
      foreground: typeof colors.foreground === "string" ? colors.foreground.toUpperCase() : null,
      mutedForeground:
        typeof colors.mutedForeground === "string" ? colors.mutedForeground.toUpperCase() : null,
      pillBackground:
        typeof colors.pillBackground === "string" ? colors.pillBackground.toUpperCase() : null,
    },
    radiusScale: Array.isArray((input as any)?.radiusScale)
      ? (input as any).radiusScale.filter((value: unknown) => Number.isFinite(value)).map(Number).slice(0, 8)
      : [],
    spacingScale: Array.isArray((input as any)?.spacingScale)
      ? (input as any).spacingScale.filter((value: unknown) => Number.isFinite(value)).map(Number).slice(0, 8)
      : [],
    typography: {
      displayFamily:
        typeof typography.displayFamily === "string" && typography.displayFamily.trim()
          ? typography.displayFamily.trim()
          : null,
      textFamily:
        typeof typography.textFamily === "string" && typography.textFamily.trim()
          ? typography.textFamily.trim()
          : null,
      headlineSize: Number.isFinite(typography.headlineSize) ? Number(typography.headlineSize) : null,
      bodySize: Number.isFinite(typography.bodySize) ? Number(typography.bodySize) : null,
      labelSize: Number.isFinite(typography.labelSize) ? Number(typography.labelSize) : null,
      metricSize: Number.isFinite(typography.metricSize) ? Number(typography.metricSize) : null,
    },
  };
}

function normalizeTextBlocks(input: unknown): ReconstructionTextBlock[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof (item as any)?.id === "string" ? (item as any).id : `text-block-${index + 1}`,
      bounds: normalizeBounds((item as any)?.bounds),
      role:
        (item as any)?.role === "headline" ||
        (item as any)?.role === "body" ||
        (item as any)?.role === "metric" ||
        (item as any)?.role === "label" ||
        (item as any)?.role === "unknown"
          ? (item as any).role
          : "unknown",
      content:
        typeof (item as any)?.content === "string" && (item as any).content.trim()
          ? (item as any).content.trim()
          : "[inferred]",
      inferred: Boolean((item as any)?.inferred),
      fontFamily:
        typeof (item as any)?.fontFamily === "string" && (item as any).fontFamily.trim()
          ? (item as any).fontFamily.trim()
          : "Inter",
      fontStyle:
        typeof (item as any)?.fontStyle === "string" && (item as any).fontStyle.trim()
          ? (item as any).fontStyle.trim()
          : null,
      fontWeight: Number.isFinite((item as any)?.fontWeight) ? Number((item as any).fontWeight) : null,
      fontSize:
        Number.isFinite((item as any)?.fontSize) && Number((item as any).fontSize) > 0
          ? Number((item as any).fontSize)
          : 16,
      lineHeight:
        Number.isFinite((item as any)?.lineHeight) ? Number((item as any).lineHeight) : null,
      letterSpacing:
        Number.isFinite((item as any)?.letterSpacing) ? Number((item as any).letterSpacing) : null,
      alignment:
        (item as any)?.alignment === "center" ||
        (item as any)?.alignment === "right" ||
        (item as any)?.alignment === "justified"
          ? (item as any).alignment
          : "left",
      colorHex:
        typeof (item as any)?.colorHex === "string" ? (item as any).colorHex.toUpperCase() : null,
    }))
    .filter((item) => item.bounds.width > 0 && item.bounds.height > 0)
    .slice(0, 40);
}

function normalizeCompletionZones(input: unknown): ReconstructionCompletionZone[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof (item as any)?.id === "string" ? (item as any).id : `completion-${index + 1}`,
      bounds: normalizeBounds((item as any)?.bounds),
      reason:
        (item as any)?.reason === "extend-background" ||
        (item as any)?.reason === "extend-layout" ||
        (item as any)?.reason === "inferred-panel"
          ? (item as any).reason
          : "unknown",
    }))
    .filter((item) => item.bounds.width > 0 && item.bounds.height > 0)
    .slice(0, 16);
}

function normalizeCompletionPlan(input: unknown): ReconstructionCompletionSuggestion[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof (item as any)?.id === "string" ? (item as any).id : `completion-plan-${index + 1}`,
      name:
        typeof (item as any)?.name === "string" && (item as any).name.trim()
          ? (item as any).name.trim()
          : `Completion ${index + 1}`,
      bounds: normalizeBounds((item as any)?.bounds),
      strategy:
        (item as any)?.strategy === "continue-module-stack" ||
        (item as any)?.strategy === "leave-minimal"
          ? (item as any).strategy
          : "conservative-extend",
      summary:
        typeof (item as any)?.summary === "string" && (item as any).summary.trim()
          ? (item as any).summary.trim()
          : "",
      priority:
        (item as any)?.priority === "high" || (item as any)?.priority === "low"
          ? (item as any).priority
          : "medium",
      inferred: (item as any)?.inferred !== false,
    }))
    .filter((item) => item.bounds.width > 0 && item.bounds.height > 0 && item.summary)
    .slice(0, 20);
}

function normalizeDeprojectionNotes(input: unknown): ReconstructionDeprojectionNote[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => ({
      id: typeof (item as any)?.id === "string" ? (item as any).id : `note-${index + 1}`,
      message:
        typeof (item as any)?.message === "string" && (item as any).message.trim()
          ? (item as any).message.trim()
          : "",
      targetId:
        typeof (item as any)?.targetId === "string" && (item as any).targetId.trim()
          ? (item as any).targetId.trim()
          : null,
    }))
    .filter((item) => item.message)
    .slice(0, 20);
}

async function analyzePreviewImage(previewDataUrl: string) {
  const { mimeType, bytes } = parsePreviewDataUrl(previewDataUrl);
  const tempPath = path.join(
    os.tmpdir(),
    `autodesign-reconstruction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extensionForMimeType(mimeType)}`,
  );

  await writeFile(tempPath, bytes);
  try {
    const scriptPath = path.join(process.cwd(), "scripts", "analyze_reference_preview.py");
    const { stdout } = await execFileAsync("python3", [scriptPath, tempPath], {
      maxBuffer: 1024 * 1024 * 4,
    });
    return {
      mimeType,
      payload: JSON.parse(stdout),
    };
  } finally {
    await rm(tempPath, { force: true });
  }
}

function fontCandidatesForRole(role: ReconstructionTextCandidate["estimatedRole"]) {
  switch (role) {
    case "metric":
      return ["SF Pro Display", "Inter", "Avenir Next"];
    case "headline":
      return ["SF Pro Display", "Inter", "Helvetica Neue"];
    case "label":
      return ["SF Pro Text", "Inter", "Avenir Next"];
    case "body":
      return ["SF Pro Text", "Inter", "Helvetica Neue"];
    default:
      return ["Inter", "SF Pro Text", "Avenir Next"];
  }
}

function buildFontMatches(textCandidates: ReconstructionTextCandidate[]): ReconstructionFontMatch[] {
  return textCandidates.slice(0, 6).map((candidate) => {
    const candidates = fontCandidatesForRole(candidate.estimatedRole);
    return {
      textCandidateId: candidate.id,
      recommended: candidates[0],
      candidates,
      confidence: candidate.confidence,
    };
  });
}

function synthesizeOcrBlocks(textCandidates: ReconstructionTextCandidate[]): ReconstructionOcrBlock[] {
  return textCandidates.slice(0, 8).map((candidate, index) => ({
    id: `ocr-${index + 1}`,
    text: null,
    confidence: Math.max(0.3, Math.min(0.75, candidate.confidence)),
    bounds: candidate.bounds,
    lineCount: candidate.estimatedRole === "body" ? 2 : 1,
    language: null,
    source: "heuristic",
  }));
}

function synthesizeTextStyleHints(
  analysisTheme: ReconstructionAnalysis["styleHints"]["theme"],
  textCandidates: ReconstructionTextCandidate[],
): ReconstructionTextStyleHint[] {
  return textCandidates.slice(0, 8).map((candidate) => ({
    textCandidateId: candidate.id,
    role: candidate.estimatedRole,
    fontCategory:
      candidate.estimatedRole === "metric" || candidate.estimatedRole === "headline"
        ? "display"
        : "text",
    fontWeightGuess:
      candidate.estimatedRole === "metric" ? 700 : candidate.estimatedRole === "headline" ? 600 : 500,
    fontSizeEstimate:
      candidate.estimatedRole === "metric" ? 32 : candidate.estimatedRole === "headline" ? 24 : 16,
    colorHex: recommendedTextColor(analysisTheme),
    alignmentGuess: "left",
    lineHeightEstimate:
      candidate.estimatedRole === "body" ? 22 : candidate.estimatedRole === "label" ? 18 : null,
    letterSpacingEstimate: 0,
    confidence: Math.max(0.4, Math.min(0.82, candidate.confidence)),
  }));
}

function synthesizeTextCandidatesFromBlocks(
  textBlocks: ReconstructionTextBlock[],
): ReconstructionTextCandidate[] {
  return textBlocks.slice(0, 12).map((block) => ({
    id: block.id,
    confidence: block.inferred ? 0.62 : 0.88,
    bounds: block.bounds,
    estimatedRole: block.role,
  }));
}

function synthesizeTextStyleHintsFromBlocks(
  textBlocks: ReconstructionTextBlock[],
): ReconstructionTextStyleHint[] {
  return textBlocks.slice(0, 12).map((block) => ({
    textCandidateId: block.id,
    role: block.role,
    fontCategory: block.role === "headline" || block.role === "metric" ? "display" : "text",
    fontWeightGuess: block.fontWeight,
    fontSizeEstimate: block.fontSize,
    colorHex: block.colorHex,
    alignmentGuess: block.alignment,
    lineHeightEstimate: block.lineHeight,
    letterSpacingEstimate: block.letterSpacing,
    confidence: block.inferred ? 0.66 : 0.9,
  }));
}

function synthesizeOcrBlocksFromBlocks(textBlocks: ReconstructionTextBlock[]): ReconstructionOcrBlock[] {
  return textBlocks.slice(0, 12).map((block, index) => ({
    id: `ocr-${index + 1}`,
    text: block.content,
    confidence: block.inferred ? 0.6 : 0.92,
    bounds: block.bounds,
    lineCount: Math.max(1, String(block.content).split("\n").length),
    language: null,
    source: block.inferred ? "heuristic" : "ocr",
  }));
}

function synthesizeSurfacesFromRegions(
  regions: ReconstructionRegion[],
  styleHints: ReconstructionAnalysis["styleHints"],
): ReconstructionDesignSurface[] {
  return regions.slice(0, 8).map((region, index) => ({
    id: region.id || `surface-${index + 1}`,
    name: `Surface ${index + 1}`,
    bounds: region.bounds,
    fillHex: region.fillHex || styleHints.primaryColorHex,
    cornerRadius: styleHints.cornerRadiusHint,
    opacity: 1,
    shadow: styleHints.shadowHint,
    inferred: false,
  }));
}

function synthesizeDesignTokens(
  styleHints: ReconstructionAnalysis["styleHints"],
  textBlocks: ReconstructionTextBlock[],
): ReconstructionDesignTokens {
  const headline = textBlocks.find((block) => block.role === "headline") || null;
  const metric = textBlocks.find((block) => block.role === "metric") || null;
  const body = textBlocks.find((block) => block.role === "body") || null;
  const label = textBlocks.find((block) => block.role === "label") || null;
  return {
    colors: {
      canvas: styleHints.primaryColorHex,
      accent: styleHints.accentColorHex,
      foreground: styleHints.theme === "dark" ? "#F5F7FF" : "#111111",
      mutedForeground: styleHints.theme === "dark" ? "#C9CCE3" : "#5C6178",
      pillBackground: styleHints.primaryColorHex,
    },
    radiusScale: uniqueNumbers([12, 18, styleHints.cornerRadiusHint]),
    spacingScale: uniqueNumbers([4, 8, 12, 16, 24, 32]),
    typography: {
      displayFamily: headline?.fontFamily || metric?.fontFamily || "SF Pro Display",
      textFamily: body?.fontFamily || label?.fontFamily || "SF Pro Text",
      headlineSize: headline?.fontSize || 24,
      bodySize: body?.fontSize || 16,
      labelSize: label?.fontSize || 12,
      metricSize: metric?.fontSize || 40,
    },
  };
}

function synthesizeSemanticNodes(
  analysis: Pick<
    ReconstructionAnalysis,
    "designSurfaces" | "textBlocks" | "vectorPrimitives" | "styleHints"
  >,
): ReconstructionSemanticNode[] {
  const nodes: ReconstructionSemanticNode[] = [
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
  ];

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

function synthesizeCompletionPlan(
  semanticNodes: ReconstructionSemanticNode[],
): ReconstructionCompletionSuggestion[] {
  const maxY = semanticNodes.length
    ? Math.max(...semanticNodes.map((item) => item.bounds.y + item.bounds.height))
    : 1;
  if (maxY >= 0.88) {
    return [];
  }

  return [
    {
      id: "completion-lower-flow",
      name: "Lower Screen Continuation",
      bounds: {
        x: 0.06,
        y: Math.min(0.9, maxY + 0.02),
        width: 0.88,
        height: Math.max(0.08, 0.96 - Math.min(0.9, maxY + 0.02)),
      },
      strategy: "conservative-extend",
      summary: "按当前卡片、圆角和 CTA 语言保守延展剩余 screen flow。",
      priority: "medium",
      inferred: true,
    },
  ];
}

function buildReviewFlags(
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

function recommendedTextColor(theme: ReconstructionAnalysis["styleHints"]["theme"]) {
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
    const ocrBlock = analysis.ocrBlocks.find((item) => item.bounds.x === candidate.bounds.x && item.bounds.y === candidate.bounds.y);
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

  for (const surface of analysis.designSurfaces) {
    const projected = projectBounds(surface.bounds, targetWidth, targetHeight);
    ops.push({
      type: "capability",
      capabilityId: "nodes.create-rectangle",
      payload: {
        name: `${namePrefix}/Surface/${surface.id}`,
        width: projected.width,
        height: projected.height,
        x: projected.x,
        y: projected.y,
        fillHex: surface.fillHex || analysis.styleHints.primaryColorHex || "#D9D9D9",
        opacity: surface.opacity ?? 1,
        cornerRadius: surface.cornerRadius ?? analysis.styleHints.cornerRadiusHint,
        parentNodeId,
        analysisRefId: surface.id,
      },
    } as FigmaCapabilityCommand);
  }

  for (const primitive of analysis.vectorPrimitives) {
    if (primitive.kind === "svg" && primitive.svgMarkup) {
      const projected = primitive.bounds
        ? projectBounds(primitive.bounds, targetWidth, targetHeight)
        : null;
      ops.push({
        type: "capability",
        capabilityId: "nodes.create-svg",
        payload: {
          name: `${namePrefix}/Primitive/${primitive.id}`,
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
          name: `${namePrefix}/Primitive/${primitive.id}`,
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
          name: `${namePrefix}/Primitive/${primitive.id}`,
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
        name: `${namePrefix}/Primitive/${primitive.id}`,
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
        name: `${namePrefix}/Text/${block.id}`,
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
      `矢量区块 ${analysis.designSurfaces.length} 个，图元 ${analysis.vectorPrimitives.length} 个，文本 ${analysis.textBlocks.length} 个。`,
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
      capabilityId: primitive.kind === "rectangle" ? "nodes.create-rectangle" : "nodes.create-rectangle",
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

export async function runPreviewOnlyReconstructionAnalysis(job: ReconstructionJob): Promise<{
  analysisVersion: string;
  analysisProvider: ReconstructionAnalysisProvider;
  analysis: ReconstructionAnalysis;
  fontMatches: ReconstructionFontMatch[];
  rebuildPlan: ReconstructionPlan;
  reviewFlags: ReconstructionReviewFlag[];
  warnings: string[];
}> {
  if (!job.referenceNode.previewDataUrl) {
    throw new Error("参考节点缺少 previewDataUrl，无法执行分析。");
  }

  const fallback = await analyzePreviewImage(job.referenceNode.previewDataUrl);
  const normalized = buildNormalizedReconstructionAnalysis(job, {
    analysisProvider: "heuristic-local",
    analysisVersion: RECONSTRUCTION_ANALYSIS_VERSION,
    analysis: fallback.payload,
    warnings: ["当前 analyze 仅执行本地 heuristic。高保真主链已切换为 Codex-assisted context pack + submit-analysis。"],
  });

  return {
    analysisVersion: normalized.analysisVersion,
    analysisProvider: normalized.analysisProvider,
    analysis: normalized.analysis,
    fontMatches: normalized.fontMatches,
    rebuildPlan: normalized.rebuildPlan,
    reviewFlags: normalized.reviewFlags,
    warnings: normalized.warnings,
  };
}

export function buildReconstructionContextPack(job: ReconstructionJob): ReconstructionContextPack {
  if (!job.referenceNode.previewDataUrl) {
    throw new Error("参考节点缺少 previewDataUrl，无法生成 Codex context pack。");
  }

  const workflow = [
    "每一轮开始前都必须同时查看 reference preview 与当前 target preview；不要只看节点树或 OCR。",
    "先判断大布局和容器结构：主卡、副卡、胶囊、分割线、顶部信息区的位置、尺寸、圆角、间距是否正确。",
    "一次只修改一个父级或一个局部组件；不要把多个父级的结构改动混在同一批命令里。",
    "每次修改后必须重新 render 并重新 measure，再决定下一步，不允许连续盲改。",
    "只有当布局、结构、颜色门槛基本通过后，才继续收紧文本内容、字号、字重和小图标。",
    "若热点集中在某个区域，下一轮只处理该区域对应的父级，不扩散到整页。",
  ];
  const scoringRubric = [
    "评分不再只看 globalSimilarity，而是以 compositeScore 为主，并同时检查 layout / structure / edge / color / hotspot gates。",
    "target_reached 只有在 compositeScore 达标且所有硬性 gates 通过时才成立。",
    "hotspotPeak 与 hotspotCoverage 会限制“平均像但局部明显错”的结果通过。",
    "refine 建议必须先说明应看哪个区域、改哪个父级，再进入写入动作。",
  ];

  return {
    jobId: job.id,
    mode: "codex-assisted",
    analysisProvider: "codex-assisted",
    analysisVersionTarget: RECONSTRUCTION_ANALYSIS_VERSION_CODEX,
    generatedAt: new Date().toISOString(),
    strategy: job.input.strategy,
    targetNode: job.targetNode,
    referenceNode: job.referenceNode,
    referencePreviewDataUrl: job.referenceRaster?.dataUrl || job.referenceNode.previewDataUrl,
    referenceRectifiedPreviewDataUrl: job.analysis?.screenPlane?.rectifiedPreviewDataUrl || null,
    targetPreviewDataUrl: job.targetNode.previewDataUrl || null,
    currentAnalysis: job.analysis,
    currentFontMatches: job.fontMatches,
    currentReviewFlags: job.reviewFlags,
    currentWarnings: job.warnings,
    workflow,
    scoringRubric,
    guidance:
      job.input.strategy === "vector-reconstruction"
        ? [
            "Codex 必须输出固定 target frame 下的正视正交矢量设计稿语义，而不是截图拆解或贴图方案。",
            "主体比例要尽量保留；frame 外侧缺失区域按相同风格做保守延展补完。",
            "最终结果必须纯可编辑矢量：文本用 text，图形用 rectangle/ellipse/line/svg。",
            "看不清的文字可以补合理文案，但必须在 textBlocks 中标记 inferred=true。",
            "优先把容器结构、卡片尺寸、圆角、层级和对齐做对，再继续补文字和细节。",
            "提交时只提交结构化 analysis；server 负责生成 vector rebuild plan。",
          ]
        : job.input.strategy === "hybrid-reconstruction"
          ? [
              "Codex 必须输出 fixed target frame 下的 hybrid analysis，而不是只给整图贴图方案。",
              "保留 raster base 作为高保真底座；文本、规则 shape、可识别 icon 优先进入可编辑 overlay。",
              "必须显式填写 canonicalFrame，并尽量声明 deprojected=true；透视和尺寸差异写入 deprojectionNotes。",
              "如参考图存在透视，请在 canonicalFrame.sourceQuad 中给出参考图平面的 4 个点，顺序固定为 top-left, top-right, bottom-right, bottom-left，坐标使用 0..1 归一化。",
              "超出参考图可直接覆盖的区域写入 completionZones；材质和背景切片写入 assetCandidates。",
              "每一轮先比对 remap preview 与当前 target render，再只修改一个局部容器或一个 overlay 组。",
              "不要强迫复杂纹理矢量化；难以编辑的材质区域留给 raster base。",
            ]
        : [
            "Codex 应基于参考图输出结构化 analysis，而不是直接修改 Figma。",
            "必须尽量提供真实文本内容、文本角色、颜色、字号、行高、字距和对齐。",
            "复杂图标或位图区域可以标记为 assetCandidates，不要强行结构化为 shape。",
            "无法确认的内容写入 uncertainties，并保留 review flag。",
            "提交时只提交结构化 analysis；preview-only rebuild plan 由 server 再生成。",
          ],
  };
}

export function buildNormalizedReconstructionAnalysis(
  job: ReconstructionJob,
  payload: {
    analysisVersion?: string;
    analysisProvider?: ReconstructionAnalysisProvider;
    analysis: unknown;
    fontMatches?: ReconstructionFontMatch[];
    reviewFlags?: ReconstructionReviewFlag[];
    warnings?: string[];
  },
): {
  analysisVersion: string;
  analysisProvider: ReconstructionAnalysisProvider;
  analysis: ReconstructionAnalysis;
  fontMatches: ReconstructionFontMatch[];
  rebuildPlan: ReconstructionPlan;
  reviewFlags: ReconstructionReviewFlag[];
  warnings: string[];
} {
  if (!job.referenceNode.previewDataUrl) {
    throw new Error("参考节点缺少 previewDataUrl，无法生成结构化分析。");
  }

  const rawAnalysis = (payload.analysis || {}) as Record<string, unknown>;
  const analysisPreviewDataUrl =
    typeof rawAnalysis.previewDataUrl === "string" && rawAnalysis.previewDataUrl.startsWith("data:image/")
      ? rawAnalysis.previewDataUrl
      : job.referenceNode.previewDataUrl;
  const mimeType =
    typeof rawAnalysis.mimeType === "string" && rawAnalysis.mimeType.trim()
      ? rawAnalysis.mimeType.trim()
      : parsePreviewDataUrl(job.referenceNode.previewDataUrl).mimeType;
  const rawWidth = Number.isFinite(rawAnalysis.width) ? Number(rawAnalysis.width) : job.referenceNode.width || 0;
  const rawHeight = Number.isFinite(rawAnalysis.height) ? Number(rawAnalysis.height) : job.referenceNode.height || 0;
  const dominantColors = normalizeColorList(rawAnalysis.dominantColors);
  const layoutRegions = normalizeRegions(rawAnalysis.layoutRegions);
  const normalizedTextBlocks = normalizeTextBlocks(rawAnalysis.textBlocks);
  const textCandidatesRaw = normalizeTextCandidates(rawAnalysis.textCandidates);
  const textCandidates =
    textCandidatesRaw.length > 0
      ? textCandidatesRaw
      : synthesizeTextCandidatesFromBlocks(normalizedTextBlocks);
  const styleHints = normalizeStyleHints(rawAnalysis.styleHints, dominantColors);
  const normalizedOcrBlocks = normalizeOcrBlocks(rawAnalysis.ocrBlocks);
  const normalizedTextStyleHints = normalizeTextStyleHints(rawAnalysis.textStyleHints);
  const designSurfacesRaw = normalizeDesignSurfaces(rawAnalysis.designSurfaces);
  const vectorPrimitives = normalizeVectorPrimitives(rawAnalysis.vectorPrimitives);
  const semanticNodes = normalizeSemanticNodes(rawAnalysis.semanticNodes);
  const designTokens = normalizeDesignTokens(rawAnalysis.designTokens);
  const completionPlan = normalizeCompletionPlan(rawAnalysis.completionPlan);
  const completionZones = normalizeCompletionZones(rawAnalysis.completionZones);
  const deprojectionNotes = normalizeDeprojectionNotes(rawAnalysis.deprojectionNotes);
  const designSurfaces =
    designSurfacesRaw.length > 0
      ? designSurfacesRaw
      : synthesizeSurfacesFromRegions(layoutRegions, styleHints);
  const analysisBase: ReconstructionAnalysis = {
    previewDataUrl: analysisPreviewDataUrl,
    mimeType,
    width: rawWidth,
    height: rawHeight,
    dominantColors,
    canonicalFrame: normalizeCanonicalFrame(rawAnalysis.canonicalFrame, job, rawWidth, rawHeight),
    screenPlane: normalizeScreenPlane(rawAnalysis.screenPlane),
    layoutRegions,
    designSurfaces,
    vectorPrimitives,
    semanticNodes,
    designTokens,
    completionPlan,
    textCandidates,
    textBlocks: normalizedTextBlocks,
    ocrBlocks: normalizedOcrBlocks.length > 0 ? normalizedOcrBlocks : synthesizeOcrBlocks(textCandidates),
    textStyleHints:
      normalizedTextStyleHints.length > 0
        ? normalizedTextStyleHints
        : normalizedTextBlocks.length > 0
          ? synthesizeTextStyleHintsFromBlocks(normalizedTextBlocks)
          : synthesizeTextStyleHints(styleHints.theme, textCandidates),
    assetCandidates: normalizeAssetCandidates(rawAnalysis.assetCandidates),
    completionZones,
    deprojectionNotes,
    styleHints,
    uncertainties: Array.isArray(rawAnalysis.uncertainties)
      ? rawAnalysis.uncertainties.filter(
          (item: unknown): item is string => typeof item === "string" && Boolean(item.trim()),
        )
      : ["当前分析结果仍包含需要人工确认的区域。"],
  };
  const derivedSemanticNodes =
    analysisBase.semanticNodes.length > 0 ? analysisBase.semanticNodes : synthesizeSemanticNodes(analysisBase);
  const analysis: ReconstructionAnalysis = {
    ...analysisBase,
    semanticNodes: derivedSemanticNodes,
    designTokens: analysisBase.designTokens || synthesizeDesignTokens(styleHints, normalizedTextBlocks),
    completionPlan:
      analysisBase.completionPlan.length > 0
        ? analysisBase.completionPlan
        : synthesizeCompletionPlan(derivedSemanticNodes),
  };

  const warnings = uniqueStrings([...(payload.warnings || [])]);
  if (!analysis.width || !analysis.height) {
    warnings.push("参考图尺寸解析不完整，后续投影可能不稳定。");
  }
  if (!job.targetNode.width || !job.targetNode.height) {
    warnings.push("目标 Frame 尺寸摘要缺失，当前计划将回退到参考图尺寸比例。");
  }
  if (analysis.textCandidates.length === 0 && analysis.textBlocks.length === 0) {
    warnings.push("当前未识别出稳定文本区域，只生成图形区块计划。");
  }
  if (job.input.strategy === "vector-reconstruction") {
    if (!analysis.canonicalFrame?.fixedTargetFrame) {
      warnings.push("vector-reconstruction 应保持 target frame 固定，当前 canonicalFrame 未明确固定。");
    }
    if (!analysis.canonicalFrame?.deprojected) {
      warnings.push("vector-reconstruction 预期输出正视正交布局，当前 analysis 未显式声明 deprojected。");
    }
    if (!analysis.screenPlane?.rectifiedPreviewDataUrl) {
      warnings.push("vector-reconstruction 当前缺少 rectified screen preview；后续评分仍可能偏向原始透视截图。");
    }
    if (analysis.semanticNodes.length === 0) {
      warnings.push("vector-reconstruction 当前缺少 semanticNodes；apply 将回退到扁平 surface/text 结构。");
    }
  }
  if (job.input.strategy === "hybrid-reconstruction") {
    if (!analysis.canonicalFrame?.fixedTargetFrame) {
      warnings.push("hybrid-reconstruction 应保持 target frame 固定，当前 canonicalFrame 未明确固定。");
    }
    if (!analysis.canonicalFrame?.deprojected) {
      warnings.push("hybrid-reconstruction 预期声明已去透视；当前 analysis 未显式声明 deprojected。");
      warnings.push("当前 apply 仍不会执行真实 perspective warp；只会按 fixed-frame mapping 放置 raster base。");
    }
    if (analysis.canonicalFrame?.deprojected && (!analysis.canonicalFrame.sourceQuad || analysis.canonicalFrame.sourceQuad.length !== 4)) {
      warnings.push("hybrid-reconstruction 标记了 deprojected=true，但 canonicalFrame.sourceQuad 缺失；当前只能做固定 frame 映射，不能做真实平面拉正。");
    }
    if (analysis.assetCandidates.length === 0) {
      warnings.push("hybrid-reconstruction 当前没有资产/材质切片候选，材质区域很可能只能依赖 raster base。");
    }
    if (analysis.completionZones.length === 0 && job.input.allowOutpainting) {
      warnings.push("allowOutpainting 已开启，但当前 analysis 没有声明 completionZones。");
    }
    if (analysis.completionZones.length > 0) {
      warnings.push("completionZones 目前只进入 review / warning，不会自动生成补图素材。");
    }
  }

  const fontMatches =
    normalizeFontMatches(payload.fontMatches, analysis.textCandidates).length > 0
      ? normalizeFontMatches(payload.fontMatches, analysis.textCandidates)
      : buildFontMatches(analysis.textCandidates);
  if (analysis.textBlocks.length > 0 && analysis.ocrBlocks.every((block) => !block.text)) {
    analysis.ocrBlocks = synthesizeOcrBlocksFromBlocks(analysis.textBlocks);
  }
  const rebuildPlan =
    job.input.strategy === "vector-reconstruction"
      ? buildVectorReconstructionPlan(job, analysis)
      : job.input.strategy === "hybrid-reconstruction"
        ? buildHybridReconstructionPlan(job, analysis)
      : buildPreviewOnlyPlan(job, analysis, fontMatches);
  const reviewFlags = uniqueReviewFlags(
    job.input.strategy === "vector-reconstruction"
      ? [...normalizeReviewFlags(payload.reviewFlags)]
      : [
          ...buildReviewFlags(job, analysis, fontMatches),
          ...normalizeReviewFlags(payload.reviewFlags),
        ],
  );

  return {
    analysisVersion:
      typeof payload.analysisVersion === "string" && payload.analysisVersion.trim()
        ? payload.analysisVersion.trim()
        : RECONSTRUCTION_ANALYSIS_VERSION_CODEX,
    analysisProvider:
      payload.analysisProvider === "codex-assisted"
        ? "codex-assisted"
        : payload.analysisProvider === "openai-responses"
          ? "openai-responses"
          : "heuristic-local",
    analysis,
    fontMatches,
    rebuildPlan,
    reviewFlags,
    warnings,
  };
}

function uniqueReviewFlags(flags: ReconstructionReviewFlag[]) {
  const byId = new Map<string, ReconstructionReviewFlag>();
  for (const flag of flags) {
    if (!flag?.id) {
      continue;
    }
    byId.set(flag.id, flag);
  }
  return [...byId.values()];
}
