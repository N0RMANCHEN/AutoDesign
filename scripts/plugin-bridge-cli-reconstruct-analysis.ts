import { writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ReconstructionJob,
  ReconstructionPoint,
  SubmitReconstructionAnalysisPayload,
} from "../shared/reconstruction.js";
import {
  type PreviewHeuristicAnalysis,
  encodeImageFileAsDataUrl,
  estimateSourceQuadPixels,
  normalizeSourceQuad,
  parseSourceQuadPixels,
  runPreviewHeuristicAnalysis,
  runVisionOcr,
  sanitizeFileSegment,
  writeRemapPreview,
} from "./plugin-bridge-cli-reconstruct-analysis-io.js";

export { estimateSourceQuadPixels, parseSourceQuadPixels, sanitizeFileSegment, writeRemapPreview } from "./plugin-bridge-cli-reconstruct-analysis-io.js";

function boundsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(left.x + left.width, right.x + right.width);
  const y1 = Math.min(left.y + left.height, right.y + right.height);
  if (x1 <= x0 || y1 <= y0) {
    return 0;
  }
  return (x1 - x0) * (y1 - y0);
}

function inferTextRole(
  bounds: { height: number },
  targetHeight: number,
  fallback?: "headline" | "body" | "metric" | "label" | "unknown",
) {
  const pixelHeight = bounds.height * targetHeight;
  if (pixelHeight >= 48) {
    return "metric" as const;
  }
  if (pixelHeight >= 28) {
    return "headline" as const;
  }
  if (pixelHeight >= 18) {
    return "body" as const;
  }
  if (fallback && fallback !== "unknown") {
    return fallback;
  }
  return "label" as const;
}

function inferTextRoleFromContent(
  content: string,
  bounds: { height: number },
  targetHeight: number,
  fallback?: "headline" | "body" | "metric" | "label" | "unknown",
) {
  const normalized = content.trim();
  const lettersOnly = normalized.replace(/[^A-Za-z]/g, "");
  const uppercaseRatio = lettersOnly.length > 0 ? lettersOnly.replace(/[A-Z]/g, "").length / lettersOnly.length : 1;
  if (/%/.test(normalized) || /^\d+(?:\.\d+)?%$/.test(normalized)) {
    return "metric" as const;
  }
  if (normalized.split(/\s+/).length >= 3 && bounds.height * targetHeight >= 26) {
    return "headline" as const;
  }
  if (lettersOnly.length > 0 && uppercaseRatio <= 0.25 && normalized.length <= 18) {
    return "label" as const;
  }
  return inferTextRole(bounds, targetHeight, fallback);
}

function makeAnalysisBlockId(prefix: string, index: number, matchedCandidateId?: string | null) {
  if (matchedCandidateId) {
    return `${matchedCandidateId}-ocr-${index + 1}`;
  }
  return `${prefix}-${index + 1}`;
}

function fontFamilyForRole(role: "headline" | "body" | "metric" | "label" | "unknown") {
  return role === "metric" || role === "headline" ? "SF Pro Display" : "SF Pro Text";
}

function fontWeightForRole(role: "headline" | "body" | "metric" | "label" | "unknown") {
  if (role === "metric") {
    return 700;
  }
  if (role === "headline") {
    return 500;
  }
  return 500;
}

function hexToRgb(hex: string | null | undefined) {
  if (!hex) {
    return null;
  }
  const normalized = hex.replace("#", "").trim();
  if (normalized.length !== 6) {
    return null;
  }
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) {
    return null;
  }
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

function relativeLuminance(hex: string | null | undefined) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return null;
  }
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(foregroundHex: string, backgroundHex: string) {
  const foreground = relativeLuminance(foregroundHex);
  const background = relativeLuminance(backgroundHex);
  if (foreground === null || background === null) {
    return 0;
  }
  const lighter = Math.max(foreground, background);
  const darker = Math.min(foreground, background);
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToHsv(hex: string | null | undefined) {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return null;
  }
  const normalizedRed = rgb.r / 255;
  const normalizedGreen = rgb.g / 255;
  const normalizedBlue = rgb.b / 255;
  const maxChannel = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const minChannel = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const delta = maxChannel - minChannel;
  const saturation = maxChannel === 0 ? 0 : delta / maxChannel;
  return {
    saturation,
    value: maxChannel,
  };
}

function estimateFontSizeFromBounds(
  content: string,
  role: "headline" | "body" | "metric" | "label" | "unknown",
  bounds: { width: number; height: number },
  targetWidth: number,
  targetHeight: number,
  hintedFontSize: number | null,
) {
  const heightPx = Math.max(8, bounds.height * targetHeight);
  const widthPx = Math.max(8, bounds.width * targetWidth);
  const glyphCount = Math.max(1, content.replace(/\s+/g, "").length);
  const widthFactor = role === "metric" ? 0.72 : role === "headline" ? 0.56 : role === "body" ? 0.62 : 0.64;
  const heightFactor = role === "metric" ? 0.58 : role === "headline" ? 0.44 : role === "body" ? 0.38 : 0.34;
  const widthBased = widthPx / (glyphCount * widthFactor);
  const heightBased = heightPx * heightFactor;
  const rawEstimate = Math.min(widthBased, heightBased);
  const hardMin = role === "metric" ? 22 : role === "headline" ? 18 : 12;
  const hardMax = role === "metric" ? 64 : role === "headline" ? 34 : role === "body" ? 22 : 18;
  const estimate = Math.max(hardMin, Math.min(hardMax, Math.round(rawEstimate)));
  if (hintedFontSize !== null && Number.isFinite(hintedFontSize)) {
    const blended = Math.round((estimate * 0.8) + (hintedFontSize * 0.2));
    return Math.max(hardMin, Math.min(hardMax, blended));
  }
  return estimate;
}

function inferTextColor(
  bounds: { x: number; y: number; width: number; height: number },
  layoutRegions: NonNullable<PreviewHeuristicAnalysis["layoutRegions"]>,
  theme: "light" | "dark",
) {
  const matchedRegion = [...layoutRegions]
    .filter((region): region is NonNullable<typeof region> & { bounds: { x: number; y: number; width: number; height: number } } =>
      Boolean(region?.bounds),
    )
    .sort((left, right) => boundsOverlap(right.bounds, bounds) - boundsOverlap(left.bounds, bounds))[0];
  if (bounds.y <= 0.1) {
    return theme === "dark" ? "#F5F7FF" : "#111111";
  }
  if (matchedRegion?.fillHex) {
    const hsv = hexToHsv(matchedRegion.fillHex);
    if (
      hsv &&
      hsv.saturation >= 0.18 &&
      hsv.value >= 0.42 &&
      bounds.x + bounds.width <= matchedRegion.bounds.x + matchedRegion.bounds.width + 0.02
    ) {
      return "#111111";
    }
    const blackContrast = contrastRatio("#111111", matchedRegion.fillHex);
    const whiteContrast = contrastRatio("#F5F7FF", matchedRegion.fillHex);
    return blackContrast >= whiteContrast ? "#111111" : "#F5F7FF";
  }
  return theme === "dark" ? "#F5F7FF" : "#111111";
}

function clampNormalized(value: number) {
  return Math.max(0, Math.min(1, value));
}

function expandNormalizedBounds(
  bounds: { x: number; y: number; width: number; height: number },
  inset: { top: number; right: number; bottom: number; left: number },
) {
  const x0 = clampNormalized(bounds.x - inset.left);
  const y0 = clampNormalized(bounds.y - inset.top);
  const x1 = clampNormalized(bounds.x + bounds.width + inset.right);
  const y1 = clampNormalized(bounds.y + bounds.height + inset.bottom);
  return {
    x: x0,
    y: y0,
    width: Math.max(0.04, x1 - x0),
    height: Math.max(0.04, y1 - y0),
  };
}

function unionNormalizedBounds(items: Array<{ bounds: { x: number; y: number; width: number; height: number } }>) {
  if (!items.length) {
    return null;
  }
  const x0 = Math.min(...items.map((item) => item.bounds.x));
  const y0 = Math.min(...items.map((item) => item.bounds.y));
  const x1 = Math.max(...items.map((item) => item.bounds.x + item.bounds.width));
  const y1 = Math.max(...items.map((item) => item.bounds.y + item.bounds.height));
  return {
    x: clampNormalized(x0),
    y: clampNormalized(y0),
    width: Math.max(0.04, clampNormalized(x1) - clampNormalized(x0)),
    height: Math.max(0.04, clampNormalized(y1) - clampNormalized(y0)),
  };
}

function synthesizeVectorShapesFromText(
  textBlocks: Array<{ content: string; bounds: { x: number; y: number; width: number; height: number } }>,
  heuristic: PreviewHeuristicAnalysis,
) {
  const accentHex = heuristic.styleHints?.accentColorHex || heuristic.dominantColors?.[1] || "#7172D7";
  const darkHex = heuristic.styleHints?.primaryColorHex || heuristic.dominantColors?.[0] || "#0C0C0D";
  const designSurfaces: Array<{
    id: string;
    name: string;
    bounds: { x: number; y: number; width: number; height: number };
    fillHex: string;
    cornerRadius: number;
    opacity: number;
    shadow: "none" | "soft";
    inferred: boolean;
  }> = [];
  const vectorPrimitives: Array<{
    id: string;
    kind: "line";
    name: string;
    bounds: { x: number; y: number; width: number; height: number };
    points: Array<{ x: number; y: number }>;
    fillHex: null;
    strokeHex: string;
    strokeWeight: number;
    opacity: number;
    cornerRadius: null;
    svgMarkup: null;
    inferred: boolean;
  }> = [];

  const headerText = textBlocks.find((block) => /^Wednesday/i.test(block.content));
  const topCardTexts = textBlocks.filter((block) => {
    if (headerText && block.content === headerText.content) {
      return false;
    }
    return block.bounds.y < 0.42 && !/^Save$/i.test(block.content) && !/^Walk/i.test(block.content);
  });
  const topUnion = unionNormalizedBounds(topCardTexts);
  if (topUnion) {
    designSurfaces.push({
      id: "surface-top-card",
      name: "Top Card",
      bounds: expandNormalizedBounds(topUnion, { top: 0.06, right: 0.03, bottom: 0.05, left: 0.03 }),
      fillHex: accentHex,
      cornerRadius: 28,
      opacity: 1,
      shadow: "soft",
      inferred: true,
    });

    const todayScore = textBlocks.find((block) => /^TODAY SCORE$/i.test(block.content));
    if (todayScore) {
      const lineY = clampNormalized(todayScore.bounds.y - 0.025);
      vectorPrimitives.push({
        id: "primitive-top-divider",
        kind: "line",
        name: "Top Divider",
        bounds: {
          x: clampNormalized(topUnion.x + 0.06),
          y: lineY,
          width: Math.max(0.12, Math.min(0.46, topUnion.width * 0.45)),
          height: 0.003,
        },
        points: [],
        fillHex: null,
        strokeHex: "#111111",
        strokeWeight: 3,
        opacity: 1,
        cornerRadius: null,
        svgMarkup: null,
        inferred: true,
      });
    }
  }

  const heuristicBottom = (heuristic.layoutRegions || []).find((region) => {
    const bounds = region?.bounds;
    return Boolean(bounds && bounds.y > 0.45 && bounds.width > 0.6);
  });
  if (heuristicBottom?.bounds) {
    designSurfaces.push({
      id: "surface-bottom-card",
      name: "Bottom Card",
      bounds: {
        x: clampNormalized(Math.max(0.08, heuristicBottom.bounds.x)),
        y: clampNormalized(Math.max(0.48, heuristicBottom.bounds.y)),
        width: Math.min(0.78, heuristicBottom.bounds.width),
        height: Math.min(0.34, heuristicBottom.bounds.height),
      },
      fillHex: accentHex,
      cornerRadius: 28,
      opacity: 1,
      shadow: "soft",
      inferred: true,
    });
  }

  const saveText = textBlocks.find((block) => /^Save$/i.test(block.content));
  if (saveText) {
    designSurfaces.push({
      id: "surface-save-pill",
      name: "Save Pill",
      bounds: expandNormalizedBounds(saveText.bounds, { top: 0.04, right: 0.08, bottom: 0.05, left: 0.06 }),
      fillHex: darkHex,
      cornerRadius: 28,
      opacity: 1,
      shadow: "none",
      inferred: true,
    });
  }

  const walkText = textBlocks.find((block) => /^Walk/i.test(block.content));
  if (walkText) {
    designSurfaces.push({
      id: "surface-walk-pill",
      name: "Walk Pill",
      bounds: expandNormalizedBounds(walkText.bounds, { top: 0.04, right: 0.08, bottom: 0.06, left: 0.06 }),
      fillHex: darkHex,
      cornerRadius: 28,
      opacity: 1,
      shadow: "none",
      inferred: true,
    });
  }

  return { designSurfaces, vectorPrimitives };
}

function uniqueNumbers(values: Array<number | null | undefined>) {
  return [...new Set(values.filter((value): value is number => Number.isFinite(value)).map((value) => Number(value)))];
}

function buildDesignTokensFromDraft(
  heuristic: PreviewHeuristicAnalysis,
  textBlocks: Array<{ role: "headline" | "body" | "metric" | "label" | "unknown"; fontFamily: string; fontSize: number }>,
) {
  const displayBlock = textBlocks.find((block) => block.role === "headline" || block.role === "metric") || null;
  const bodyBlock = textBlocks.find((block) => block.role === "body") || null;
  const labelBlock = textBlocks.find((block) => block.role === "label") || null;
  const accentHex = heuristic.styleHints?.accentColorHex || heuristic.dominantColors?.[1] || "#7172D7";
  const canvasHex = heuristic.styleHints?.primaryColorHex || heuristic.dominantColors?.[0] || "#0C0C0D";
  return {
    colors: {
      canvas: canvasHex,
      accent: accentHex,
      foreground: heuristic.styleHints?.theme === "dark" ? "#F5F7FF" : "#111111",
      mutedForeground: heuristic.styleHints?.theme === "dark" ? "#C9CCE3" : "#5C6178",
      pillBackground: canvasHex,
    },
    radiusScale: uniqueNumbers([12, 18, 28, heuristic.styleHints?.cornerRadiusHint || 28]),
    spacingScale: uniqueNumbers([4, 8, 12, 16, 24, 32]),
    typography: {
      displayFamily: displayBlock?.fontFamily || "SF Pro Display",
      textFamily: bodyBlock?.fontFamily || labelBlock?.fontFamily || "SF Pro Text",
      headlineSize: textBlocks.find((block) => block.role === "headline")?.fontSize || 24,
      bodySize: bodyBlock?.fontSize || 16,
      labelSize: labelBlock?.fontSize || 12,
      metricSize: textBlocks.find((block) => block.role === "metric")?.fontSize || 40,
    },
  };
}

function buildSemanticNodesFromDraft(
  designSurfaces: Array<{ id: string; name: string; bounds: { x: number; y: number; width: number; height: number }; fillHex: string; cornerRadius: number }>,
  textBlocks: Array<{ id: string; content: string; bounds: { x: number; y: number; width: number; height: number } }>,
  vectorPrimitives: Array<{ id: string; bounds: { x: number; y: number; width: number; height: number } | null }>,
) {
  const nodes: Array<Record<string, unknown>> = [
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
      fillHex: null,
      cornerRadius: 0,
      componentName: null,
    },
  ];

  const addContainerNode = (surfaceId: string, name: string, kind: string, componentName: string | null) => {
    const surface = designSurfaces.find((item) => item.id === surfaceId);
    if (!surface) {
      return;
    }
    nodes.push({
      id: `semantic-${surfaceId}`,
      name,
      kind,
      parentId: "semantic-screen-root",
      bounds: surface.bounds,
      inferred: true,
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
      componentName,
    });
  };

  addContainerNode("surface-top-card", "Top Card", "card", "MissionCard");
  addContainerNode("surface-bottom-card", "Bottom Card", "card", "WorkoutCard");
  addContainerNode("surface-save-pill", "Save Pill", "pill", "ActionPill");
  addContainerNode("surface-walk-pill", "Walk Pill", "pill", "ActionPill");

  for (const block of textBlocks) {
    const parentSurface = designSurfaces.find((surface) => boundsOverlap(surface.bounds, block.bounds) > 0.45) || null;
    nodes.push({
      id: `semantic-${block.id}`,
      name: block.content.slice(0, 32) || block.id,
      kind: /^Wednesday/i.test(block.content) ? "header" : "text",
      parentId: parentSurface ? `semantic-${parentSurface.id}` : "semantic-screen-root",
      bounds: block.bounds,
      inferred: false,
      surfaceRefId: null,
      textRefId: block.id,
      primitiveRefId: null,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: null,
      paddingRight: null,
      paddingBottom: null,
      paddingLeft: null,
      fillHex: null,
      cornerRadius: null,
      componentName: null,
    });
  }

  for (const primitive of vectorPrimitives) {
    if (!primitive.bounds) {
      continue;
    }
    const parentSurface = designSurfaces.find((surface) => boundsOverlap(surface.bounds, primitive.bounds as any) > 0.45) || null;
    nodes.push({
      id: `semantic-${primitive.id}`,
      name: primitive.id,
      kind: "primitive",
      parentId: parentSurface ? `semantic-${parentSurface.id}` : "semantic-screen-root",
      bounds: primitive.bounds,
      inferred: true,
      surfaceRefId: null,
      textRefId: null,
      primitiveRefId: primitive.id,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: null,
      paddingRight: null,
      paddingBottom: null,
      paddingLeft: null,
      fillHex: null,
      cornerRadius: null,
      componentName: null,
    });
  }

  if (nodes.length === 1) {
    nodes.push({
      id: "semantic-fallback-section",
      name: "Primary Section",
      kind: "section",
      parentId: "semantic-screen-root",
      bounds: { x: 0.04, y: 0.08, width: 0.92, height: 0.84 },
      inferred: true,
      surfaceRefId: null,
      textRefId: null,
      primitiveRefId: null,
      layoutMode: "NONE",
      itemSpacing: null,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      fillHex: null,
      cornerRadius: null,
      componentName: null,
    });
  }

  return nodes;
}

function buildCompletionPlanFromDraft(semanticNodes: Array<Record<string, unknown>>, targetHeight: number) {
  const semanticBounds = semanticNodes
    .map((item) => item.bounds as { x: number; y: number; width: number; height: number } | undefined)
    .filter(Boolean);
  if (!semanticBounds.length) {
    return [];
  }

  const maxY = Math.max(...semanticBounds.map((bounds) => bounds.y + bounds.height));
  if (maxY >= 0.88) {
    return [];
  }

  return [
    {
      id: "completion-lower-flow",
      name: "Lower Screen Continuation",
      bounds: {
        x: 0.06,
        y: Math.min(0.88, maxY + 0.02),
        width: 0.88,
        height: Math.max(0.08, 0.96 - Math.min(0.88, maxY + 0.02)),
      },
      strategy: "conservative-extend",
      summary: `按当前卡片和胶囊语言继续延展剩余 screen flow；保持 ${targetHeight}px 高度屏幕内的保守信息架构。`,
      priority: "medium",
      inferred: true,
    },
  ];
}

export async function writeVectorAnalysisDraft(
  job: ReconstructionJob,
  sourceQuadPixels: ReconstructionPoint[],
  remapPreviewPath: string,
  outputDirectory: string,
) {
  const referenceWidth = job.referenceRaster?.width || job.referenceNode.width || 0;
  const referenceHeight = job.referenceRaster?.height || job.referenceNode.height || 0;
  const targetWidth = Math.max(1, Math.round(job.targetNode.width || 0));
  const targetHeight = Math.max(1, Math.round(job.targetNode.height || 0));
  const baseName = sanitizeFileSegment(job.id);
  const draftPath = path.join(outputDirectory, `${baseName}-vector-analysis-draft.json`);
  const normalizedQuad = normalizeSourceQuad(sourceQuadPixels, referenceWidth, referenceHeight);
  const heuristic = await runPreviewHeuristicAnalysis(remapPreviewPath);
  const ocrLines = await runVisionOcr(remapPreviewPath);
  const rectifiedPreviewDataUrl = await encodeImageFileAsDataUrl(remapPreviewPath);
  const textCandidates = heuristic.textCandidates || [];
  const textStyleHints = heuristic.textStyleHints || [];
  const layoutRegions = heuristic.layoutRegions || [];
  const theme = heuristic.styleHints?.theme === "light" ? "light" : "dark";
  const defaultTextColor = theme === "dark" ? "#F5F7FF" : "#111111";

  const textBlocks = ocrLines.length
    ? ocrLines
        .filter((line) => Boolean(line.text.trim()))
        .map((line, index) => {
          const matchedCandidate = [...textCandidates]
            .filter((candidate): candidate is NonNullable<typeof candidate> & { id: string; bounds: { x: number; y: number; width: number; height: number } } =>
              Boolean(candidate?.id && candidate.bounds),
            )
            .sort((left, right) => boundsOverlap(right.bounds, line.bounds) - boundsOverlap(left.bounds, line.bounds))[0];
          const styleHint = matchedCandidate ? textStyleHints.find((hint) => hint.textCandidateId === matchedCandidate.id) : null;
          const role = inferTextRoleFromContent(line.text.trim(), line.bounds, targetHeight, matchedCandidate?.estimatedRole);
          const roleMatchedHint = styleHint?.role === role ? styleHint : null;
          const hintedFontSize =
            roleMatchedHint?.fontSizeEstimate && Number.isFinite(roleMatchedHint.fontSizeEstimate)
              ? Number(roleMatchedHint.fontSizeEstimate)
              : null;
          const fontSize = estimateFontSizeFromBounds(line.text.trim(), role, line.bounds, targetWidth, targetHeight, hintedFontSize);
          const lineHeight =
            roleMatchedHint?.lineHeightEstimate && Number.isFinite(roleMatchedHint.lineHeightEstimate)
              ? Math.max(fontSize, Number(roleMatchedHint.lineHeightEstimate))
              : role === "body"
                ? Math.round(fontSize * 1.2)
                : role === "label"
                  ? Math.round(fontSize * 1.1)
                  : null;
          const colorHex =
            roleMatchedHint?.colorHex && roleMatchedHint.colorHex !== defaultTextColor
              ? roleMatchedHint.colorHex
              : inferTextColor(line.bounds, layoutRegions, theme);
          return {
            id: makeAnalysisBlockId("ocr-line", index, matchedCandidate?.id || null),
            bounds: line.bounds,
            role,
            content: line.text.trim(),
            inferred: line.confidence < 0.6,
            fontFamily: fontFamilyForRole(role),
            fontStyle: null,
            fontWeight:
              roleMatchedHint?.fontWeightGuess && Number.isFinite(roleMatchedHint.fontWeightGuess)
                ? Number(roleMatchedHint.fontWeightGuess)
                : fontWeightForRole(role),
            fontSize,
            lineHeight,
            letterSpacing:
              roleMatchedHint?.letterSpacingEstimate && Number.isFinite(roleMatchedHint.letterSpacingEstimate)
                ? Number(roleMatchedHint.letterSpacingEstimate)
                : 0,
            alignment:
              roleMatchedHint?.alignmentGuess && roleMatchedHint.alignmentGuess !== "unknown"
                ? roleMatchedHint.alignmentGuess
                : "left",
            colorHex,
          };
        })
    : [];
  const synthesizedShapes = synthesizeVectorShapesFromText(textBlocks, heuristic);
  const designTokens = buildDesignTokensFromDraft(heuristic, textBlocks);
  const semanticNodes = buildSemanticNodesFromDraft(synthesizedShapes.designSurfaces, textBlocks, synthesizedShapes.vectorPrimitives);
  const completionPlan = buildCompletionPlanFromDraft(semanticNodes, targetHeight);

  const payload: SubmitReconstructionAnalysisPayload = {
    analysisProvider: "codex-assisted",
    analysisVersion: "2026-03-23-vector-draft-v1",
    warnings: ["这是 CLI 生成的 vector analysis draft；当前优先恢复可编辑文本和大区块，复杂图标/纹理仍未完全结构化。"],
    analysis: {
      previewDataUrl: rectifiedPreviewDataUrl,
      width: targetWidth,
      height: targetHeight,
      dominantColors: heuristic.dominantColors || ["#0D0D12", "#AA99FF"],
      canonicalFrame: {
        width: targetWidth,
        height: targetHeight,
        fixedTargetFrame: true,
        deprojected: true,
        mappingMode: "reflow",
        sourceQuad: normalizedQuad,
      },
      screenPlane: {
        extracted: true,
        excludesNonUiShell: true,
        confidence: 0.82,
        sourceQuad: normalizedQuad,
        rectifiedPreviewDataUrl,
      },
      layoutRegions: heuristic.layoutRegions || [],
      designSurfaces: synthesizedShapes.designSurfaces,
      vectorPrimitives: synthesizedShapes.vectorPrimitives,
      semanticNodes,
      designTokens,
      completionPlan,
      textCandidates,
      textBlocks,
      ocrBlocks: ocrLines.map((line, index) => ({
        id: `ocr-${index + 1}`,
        text: line.text.trim(),
        confidence: line.confidence,
        bounds: line.bounds,
        lineCount: Math.max(1, line.text.split(/\n+/).length),
        language: null,
        source: "ocr",
      })),
      textStyleHints,
      assetCandidates: heuristic.assetCandidates || [],
      styleHints: {
        theme,
        cornerRadiusHint: heuristic.styleHints?.cornerRadiusHint || 28,
        shadowHint: heuristic.styleHints?.shadowHint || "none",
        primaryColorHex: heuristic.styleHints?.primaryColorHex || "#0D0D12",
        accentColorHex: heuristic.styleHints?.accentColorHex || "#AA99FF",
      },
      uncertainties: [
        ...(heuristic.uncertainties || []),
        "当前 vector draft 仍不会自动恢复复杂插画/纹理；主要恢复文本层和大矩形区块。",
      ],
    },
  };
  await writeFile(draftPath, JSON.stringify(payload, null, 2), "utf8");
  return draftPath;
}

export async function writeHybridAnalysisDraft(
  job: ReconstructionJob,
  sourceQuadPixels: ReconstructionPoint[],
  remapPreviewPath: string,
  outputDirectory: string,
) {
  const referenceWidth = job.referenceRaster?.width || job.referenceNode.width || 0;
  const referenceHeight = job.referenceRaster?.height || job.referenceNode.height || 0;
  const targetWidth = Math.max(1, Math.round(job.targetNode.width || 0));
  const targetHeight = Math.max(1, Math.round(job.targetNode.height || 0));
  const baseName = sanitizeFileSegment(job.id);
  const draftPath = path.join(outputDirectory, `${baseName}-hybrid-analysis-draft.json`);
  const normalizedQuad = normalizeSourceQuad(sourceQuadPixels, referenceWidth, referenceHeight);
  const rectifiedPreviewDataUrl = await encodeImageFileAsDataUrl(remapPreviewPath);
  const payload: SubmitReconstructionAnalysisPayload = {
    analysisProvider: "codex-assisted",
    analysisVersion: "2026-03-23-hybrid-draft-v1",
    warnings: ["这是 CLI 生成的 hybrid analysis draft；请在 submit 前继续补充 textBlocks、assetCandidates、completionZones。"],
    analysis: {
      previewDataUrl: rectifiedPreviewDataUrl,
      width: referenceWidth,
      height: referenceHeight,
      dominantColors: ["#0D0D12", "#AA99FF"],
      canonicalFrame: {
        width: targetWidth,
        height: targetHeight,
        fixedTargetFrame: true,
        deprojected: true,
        mappingMode: "reflow",
        sourceQuad: normalizedQuad,
      },
      screenPlane: {
        extracted: true,
        excludesNonUiShell: true,
        confidence: 0.72,
        sourceQuad: normalizedQuad,
        rectifiedPreviewDataUrl,
      },
      layoutRegions: [],
      designSurfaces: [],
      vectorPrimitives: [],
      semanticNodes: [],
      designTokens: null,
      completionPlan: [],
      textCandidates: [],
      textBlocks: [],
      ocrBlocks: [],
      textStyleHints: [],
      assetCandidates: [],
      completionZones: [],
      deprojectionNotes: [
        {
          id: "source-quad-draft",
          message: "sourceQuad 由 plugin:reconstruct 的 remap/draft 工作流生成，仍需人工确认。",
          targetId: null,
        },
      ],
      styleHints: {
        theme: "dark",
        cornerRadiusHint: 28,
        shadowHint: "none",
        primaryColorHex: "#0D0D12",
        accentColorHex: "#AA99FF",
      },
      uncertainties: ["当前 draft 只包含 fixed-frame + deprojection 骨架，未自动恢复可编辑 overlay。"],
    },
  };
  await writeFile(draftPath, JSON.stringify(payload, null, 2), "utf8");
  return draftPath;
}
