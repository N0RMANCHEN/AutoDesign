import type {
  ReconstructionAnalysis,
  ReconstructionAnalysisProvider,
  ReconstructionAssetCandidate,
  ReconstructionBounds,
  ReconstructionCanonicalFrame,
  ReconstructionCompletionSuggestion,
  ReconstructionCompletionZone,
  ReconstructionDeprojectionNote,
  ReconstructionDesignSurface,
  ReconstructionDesignTokens,
  ReconstructionFontMatch,
  ReconstructionJob,
  ReconstructionOcrBlock,
  ReconstructionPoint,
  ReconstructionRegion,
  ReconstructionReviewFlag,
  ReconstructionScreenPlane,
  ReconstructionSemanticNode,
  ReconstructionTextBlock,
  ReconstructionTextCandidate,
  ReconstructionTextStyleHint,
  ReconstructionVectorPrimitive,
} from "../../shared/reconstruction.js";
import { normalizeReconstructionElements } from "./reconstruction-element-model.js";

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

export function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
    .filter((item) => (item.kind === "svg" ? Boolean(item.svgMarkup) : item.bounds !== null || item.points.length > 0))
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
        typeof (item as any)?.parentId === "string" && (item as any)?.parentId.trim()
          ? (item as any).parentId.trim()
          : null,
      bounds: normalizeBounds((item as any)?.bounds),
      inferred: Boolean((item as any)?.inferred),
      surfaceRefId:
        typeof (item as any)?.surfaceRefId === "string" && (item as any)?.surfaceRefId.trim()
          ? (item as any).surfaceRefId.trim()
          : null,
      textRefId:
        typeof (item as any)?.textRefId === "string" && (item as any)?.textRefId.trim()
          ? (item as any).textRefId.trim()
          : null,
      primitiveRefId:
        typeof (item as any)?.primitiveRefId === "string" && (item as any)?.primitiveRefId.trim()
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
        typeof (item as any)?.componentName === "string" && (item as any)?.componentName.trim()
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
        typeof (item as any)?.targetId === "string" && (item as any)?.targetId.trim()
          ? (item as any).targetId.trim()
          : null,
    }))
    .filter((item) => item.message)
    .slice(0, 20);
}

export function normalizeReconstructionFontMatches(
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

export function normalizeReconstructionReviewFlags(input: unknown): ReconstructionReviewFlag[] {
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

export function uniqueReviewFlags(flags: ReconstructionReviewFlag[]) {
  const byId = new Map<string, ReconstructionReviewFlag>();
  for (const flag of flags) {
    if (!flag?.id) {
      continue;
    }
    byId.set(flag.id, flag);
  }
  return [...byId.values()];
}

export function normalizeReconstructionAnalysisPayload(
  job: ReconstructionJob,
  rawAnalysis: Record<string, unknown>,
  rawWidth: number,
  rawHeight: number,
) {
  const dominantColors = normalizeColorList(rawAnalysis.dominantColors);
  return {
    dominantColors,
    layoutRegions: normalizeRegions(rawAnalysis.layoutRegions),
    normalizedTextBlocks: normalizeTextBlocks(rawAnalysis.textBlocks),
    textCandidatesRaw: normalizeTextCandidates(rawAnalysis.textCandidates),
    styleHints: normalizeStyleHints(rawAnalysis.styleHints, dominantColors),
    normalizedOcrBlocks: normalizeOcrBlocks(rawAnalysis.ocrBlocks),
    normalizedTextStyleHints: normalizeTextStyleHints(rawAnalysis.textStyleHints),
    designSurfacesRaw: normalizeDesignSurfaces(rawAnalysis.designSurfaces),
    vectorPrimitives: normalizeVectorPrimitives(rawAnalysis.vectorPrimitives),
    semanticNodes: normalizeSemanticNodes(rawAnalysis.semanticNodes),
    normalizedElements: normalizeReconstructionElements(rawAnalysis.elements),
    designTokens: normalizeDesignTokens(rawAnalysis.designTokens),
    completionPlan: normalizeCompletionPlan(rawAnalysis.completionPlan),
    completionZones: normalizeCompletionZones(rawAnalysis.completionZones),
    deprojectionNotes: normalizeDeprojectionNotes(rawAnalysis.deprojectionNotes),
    canonicalFrame: normalizeCanonicalFrame(rawAnalysis.canonicalFrame, job, rawWidth, rawHeight),
    screenPlane: normalizeScreenPlane(rawAnalysis.screenPlane),
    assetCandidates: normalizeAssetCandidates(rawAnalysis.assetCandidates),
    uncertainties: Array.isArray(rawAnalysis.uncertainties)
      ? rawAnalysis.uncertainties.filter(
          (item: unknown): item is string => typeof item === "string" && Boolean(item.trim()),
        )
      : ["当前分析结果仍包含需要人工确认的区域。"],
  };
}

export function resolveReconstructionAnalysisProvider(
  provider: ReconstructionAnalysisProvider | undefined,
): ReconstructionAnalysisProvider {
  return provider === "codex-assisted"
    ? "codex-assisted"
    : provider === "openai-responses"
      ? "openai-responses"
      : "heuristic-local";
}
