import type {
  ReconstructionAnalysis,
  ReconstructionDesignSurface,
  ReconstructionDesignTokens,
  ReconstructionFontMatch,
  ReconstructionOcrBlock,
  ReconstructionRegion,
  ReconstructionSemanticNode,
  ReconstructionTextBlock,
  ReconstructionTextCandidate,
  ReconstructionTextStyleHint,
} from "../../shared/reconstruction.js";
import { recommendedTextColor } from "./rebuild-planning.js";

function uniqueNumbers(values: Array<number | null | undefined>) {
  return [...new Set(values.filter((value): value is number => Number.isFinite(value)).map(Number))];
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

export function buildDefaultReconstructionFontMatches(
  textCandidates: ReconstructionTextCandidate[],
): ReconstructionFontMatch[] {
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

export function synthesizeReconstructionOcrBlocks(
  textCandidates: ReconstructionTextCandidate[],
): ReconstructionOcrBlock[] {
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

export function synthesizeReconstructionTextStyleHints(
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

export function synthesizeReconstructionTextCandidatesFromBlocks(
  textBlocks: ReconstructionTextBlock[],
): ReconstructionTextCandidate[] {
  return textBlocks.slice(0, 12).map((block) => ({
    id: block.id,
    confidence: block.inferred ? 0.62 : 0.88,
    bounds: block.bounds,
    estimatedRole: block.role,
  }));
}

export function synthesizeReconstructionTextStyleHintsFromBlocks(
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

export function synthesizeReconstructionOcrBlocksFromBlocks(
  textBlocks: ReconstructionTextBlock[],
): ReconstructionOcrBlock[] {
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

export function synthesizeReconstructionDesignSurfaces(
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

export function synthesizeReconstructionDesignTokens(
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

export function synthesizeReconstructionCompletionPlan(
  semanticNodes: ReconstructionSemanticNode[],
): ReconstructionAnalysis["completionPlan"] {
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
