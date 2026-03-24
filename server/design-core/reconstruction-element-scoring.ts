import type { PluginNodeInspection } from "../../shared/plugin-bridge.js";
import type {
  ReconstructionAnalysis,
  ReconstructionBounds,
  ReconstructionElement,
  ReconstructionElementConstraint,
  ReconstructionElementScore,
} from "../../shared/reconstruction.js";
import { measureElementDiff } from "../reconstruction-evaluation.js";
import {
  boundsArea,
  clampNormalizedBounds,
  collectReconstructionElements,
  getElementBounds,
  overlapRatio,
} from "./reconstruction-element-model.js";

type MatchedNode = {
  node: PluginNodeInspection;
  strategy: "analysis-ref" | "heuristic";
  bounds: ReconstructionBounds;
};

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeNodeBounds(
  node: PluginNodeInspection,
  root: PluginNodeInspection,
): ReconstructionBounds | null {
  const rootWidth = Number(root.width || 0);
  const rootHeight = Number(root.height || 0);
  if (!rootWidth || !rootHeight) {
    return null;
  }

  const rootAbsoluteX = Number.isFinite(root.absoluteX) ? Number(root.absoluteX) : Number(root.x || 0);
  const rootAbsoluteY = Number.isFinite(root.absoluteY) ? Number(root.absoluteY) : Number(root.y || 0);
  const absoluteX = Number.isFinite(node.absoluteX) ? Number(node.absoluteX) : Number(node.x || 0);
  const absoluteY = Number.isFinite(node.absoluteY) ? Number(node.absoluteY) : Number(node.y || 0);
  const width = Number(node.width || 0);
  const height = Number(node.height || 0);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return clampNormalizedBounds({
    x: (absoluteX - rootAbsoluteX) / rootWidth,
    y: (absoluteY - rootAbsoluteY) / rootHeight,
    width: width / rootWidth,
    height: height / rootHeight,
  });
}

function normalizeFontWeight(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.toLowerCase();
  if (normalized.includes("extra bold")) return 800;
  if (normalized.includes("bold")) return 700;
  if (normalized.includes("semi")) return 600;
  if (normalized.includes("medium")) return 500;
  if (normalized.includes("light")) return 300;
  if (normalized.includes("regular")) return 400;
  return null;
}

function candidateKindsForElement(element: ReconstructionElement) {
  if (element.kind === "text") {
    return new Set(["TEXT"]);
  }
  if (element.kind === "surface" || element.kind === "group") {
    return new Set(["FRAME", "GROUP", "RECTANGLE", "ELLIPSE", "INSTANCE", "COMPONENT"]);
  }
  if (element.kind === "icon") {
    return new Set(["VECTOR", "BOOLEAN_OPERATION", "FRAME", "GROUP", "RECTANGLE"]);
  }
  return new Set(["VECTOR", "BOOLEAN_OPERATION", "LINE", "RECTANGLE", "ELLIPSE", "FRAME", "GROUP"]);
}

function buildNameSimilarity(element: ReconstructionElement, node: PluginNodeInspection) {
  const left = element.name.trim().toLowerCase();
  const right = node.name.trim().toLowerCase();
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (right.includes(left) || left.includes(right)) {
    return 0.7;
  }
  return 0;
}

function buildContentSimilarity(element: ReconstructionElement, node: PluginNodeInspection) {
  if (!element.content || !node.textContent) {
    return 0;
  }
  const left = element.content.replace(/\s+/g, " ").trim().toLowerCase();
  const right = node.textContent.replace(/\s+/g, " ").trim().toLowerCase();
  if (left === right) {
    return 1;
  }
  if (left && right && (left.includes(right) || right.includes(left))) {
    return 0.75;
  }
  return 0;
}

function matchReconstructionElementsToNodes(
  elements: ReconstructionElement[],
  inspectedNodes: PluginNodeInspection[],
) {
  const root = inspectedNodes[0] || null;
  if (!root) {
    return new Map<string, MatchedNode>();
  }

  const nodeBounds = new Map<string, ReconstructionBounds>();
  for (const node of inspectedNodes) {
    const bounds = normalizeNodeBounds(node, root);
    if (bounds) {
      nodeBounds.set(node.id, bounds);
    }
  }

  const usedNodeIds = new Set<string>();
  const matches = new Map<string, MatchedNode>();
  const byAnalysisRef = new Map<string, PluginNodeInspection>();
  for (const node of inspectedNodes) {
    if (node.analysisRefId) {
      byAnalysisRef.set(node.analysisRefId, node);
    }
  }

  const orderedElements = [...elements].sort(
    (left, right) => boundsArea(getElementBounds(right)) - boundsArea(getElementBounds(left)),
  );

  for (const element of orderedElements) {
    if (element.analysisRefId) {
      const direct = byAnalysisRef.get(element.analysisRefId);
      if (direct && nodeBounds.has(direct.id)) {
        matches.set(element.id, {
          node: direct,
          strategy: "analysis-ref",
          bounds: nodeBounds.get(direct.id)!,
        });
        usedNodeIds.add(direct.id);
        continue;
      }
    }

    const supportedTypes = candidateKindsForElement(element);
    const targetBounds = getElementBounds(element);
    let bestCandidate: { node: PluginNodeInspection; bounds: ReconstructionBounds; score: number } | null = null;
    for (const node of inspectedNodes.slice(1)) {
      if (!supportedTypes.has(node.type) || usedNodeIds.has(node.id)) {
        continue;
      }
      const bounds = nodeBounds.get(node.id);
      if (!bounds) {
        continue;
      }
      const score =
        (0.7 * overlapRatio(targetBounds, bounds)) +
        (0.2 * buildNameSimilarity(element, node)) +
        (0.1 * buildContentSimilarity(element, node));
      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = { node, bounds, score };
      }
    }
    if (bestCandidate && bestCandidate.score >= 0.2) {
      matches.set(element.id, {
        node: bestCandidate.node,
        strategy: "heuristic",
        bounds: bestCandidate.bounds,
      });
      usedNodeIds.add(bestCandidate.node.id);
    }
  }

  return matches;
}

function scoreFromDiff(diff: number, divisor: number) {
  return clamp01(1 - Math.abs(diff) / Math.max(0.0001, divisor));
}

function computeGeometryScore(
  element: ReconstructionElement,
  matchedNode: MatchedNode | null,
) {
  if (!matchedNode) {
    return 0;
  }
  const targetBounds = getElementBounds(element);
  const nodeBounds = matchedNode.bounds;
  const scores = [
    scoreFromDiff(targetBounds.x - nodeBounds.x, 0.03),
    scoreFromDiff(targetBounds.y - nodeBounds.y, 0.03),
    scoreFromDiff(targetBounds.width - nodeBounds.width, 0.05),
    scoreFromDiff(targetBounds.height - nodeBounds.height, 0.05),
  ];
  return Number((scores.reduce((sum, item) => sum + item, 0) / scores.length).toFixed(4));
}

function computeStyleScore(
  element: ReconstructionElement,
  matchedNode: MatchedNode | null,
) {
  if (!matchedNode) {
    return 0;
  }

  const checks: number[] = [];
  if (element.style.fillHex) {
    checks.push(matchedNode.node.fills.includes(element.style.fillHex) ? 1 : 0.35);
  }
  if (element.style.strokeHex) {
    checks.push(matchedNode.node.strokes?.includes(element.style.strokeHex) ? 1 : 0.35);
  }
  if (element.style.opacity !== null) {
    checks.push(scoreFromDiff((matchedNode.node.opacity ?? 1) - element.style.opacity, 0.2));
  }
  if (element.style.cornerRadius !== null) {
    checks.push(scoreFromDiff((matchedNode.node.cornerRadius ?? 0) - element.style.cornerRadius, 8));
  }
  if (!checks.length) {
    return matchedNode.node.type === "TEXT" ? 1 : 0.85;
  }
  return Number((checks.reduce((sum, item) => sum + item, 0) / checks.length).toFixed(4));
}

function computeTypographyScore(
  element: ReconstructionElement,
  matchedNode: MatchedNode | null,
) {
  if (element.kind !== "text") {
    return 1;
  }
  if (!matchedNode) {
    return 0;
  }
  const checks: number[] = [];
  if (element.content) {
    checks.push(buildContentSimilarity(element, matchedNode.node));
  }
  if (element.style.fontSize !== null) {
    checks.push(scoreFromDiff((matchedNode.node.fontSize ?? 0) - element.style.fontSize, 4));
  }
  if (element.style.fontWeight !== null) {
    checks.push(
      scoreFromDiff(
        (normalizeFontWeight(matchedNode.node.fontWeight) ?? 400) - element.style.fontWeight,
        200,
      ),
    );
  }
  if (element.style.alignment) {
    const alignment =
      matchedNode.node.textAlignment?.toLowerCase() === "center"
        ? "center"
        : matchedNode.node.textAlignment?.toLowerCase() === "right"
          ? "right"
          : matchedNode.node.textAlignment?.toLowerCase() === "justified"
            ? "justified"
            : "left";
    checks.push(alignment === element.style.alignment ? 1 : 0.4);
  }
  if (element.style.fontFamily) {
    const family = (matchedNode.node.fontFamily || "").toLowerCase();
    checks.push(family.includes(element.style.fontFamily.toLowerCase()) ? 1 : 0.45);
  }
  if (!checks.length) {
    return 0.8;
  }
  return Number((checks.reduce((sum, item) => sum + item, 0) / checks.length).toFixed(4));
}

function computeEditabilityScore(
  element: ReconstructionElement,
  matchedNode: MatchedNode | null,
) {
  if (!matchedNode) {
    return 0;
  }
  if (matchedNode.node.hasImageFill) {
    return 0;
  }

  switch (element.editableKind) {
    case "text":
      return matchedNode.node.type === "TEXT" ? 1 : 0;
    case "frame":
    case "group":
      return matchedNode.node.type === "FRAME" || matchedNode.node.type === "RECTANGLE" ? 1 : 0.65;
    case "shape":
      return matchedNode.node.type === "RECTANGLE" || matchedNode.node.type === "ELLIPSE" ? 1 : 0.6;
    case "vector":
      return matchedNode.node.type === "VECTOR" ||
        matchedNode.node.type === "BOOLEAN_OPERATION" ||
        matchedNode.node.type === "LINE" ||
        matchedNode.node.type === "RECTANGLE"
        ? 1
        : 0.55;
    default:
      return 0.8;
  }
}

function evaluateConstraint(
  constraint: ReconstructionElementConstraint,
  matches: Map<string, MatchedNode>,
) {
  const bounds = constraint.elementIds
    .map((elementId) => matches.get(elementId)?.bounds || null)
    .filter((value): value is ReconstructionBounds => Boolean(value));
  if (bounds.length < 2) {
    return 1;
  }

  const tolerance = constraint.tolerance ?? 0.015;
  if (constraint.kind === "align-top") {
    const values = bounds.map((item) => item.y);
    return scoreFromDiff(Math.max(...values) - Math.min(...values), tolerance);
  }
  if (constraint.kind === "align-bottom" || constraint.kind === "share-baseline") {
    const values = bounds.map((item) => item.y + item.height);
    return scoreFromDiff(Math.max(...values) - Math.min(...values), tolerance);
  }
  if (constraint.kind === "align-left") {
    const values = bounds.map((item) => item.x);
    return scoreFromDiff(Math.max(...values) - Math.min(...values), tolerance);
  }
  if (constraint.kind === "align-right") {
    const values = bounds.map((item) => item.x + item.width);
    return scoreFromDiff(Math.max(...values) - Math.min(...values), tolerance);
  }
  if (constraint.kind === "same-parent") {
    const parent = matches.get(constraint.elementIds[0])?.node || null;
    const child = matches.get(constraint.elementIds[1])?.node || null;
    if (!parent || !child) {
      return 1;
    }
    return parent.id === child.parentNodeId ? 1 : 0;
  }
  return 1;
}

function computeAlignmentScore(
  element: ReconstructionElement,
  constraints: ReconstructionElementConstraint[],
  matches: Map<string, MatchedNode>,
) {
  const relevant = constraints.filter((constraint) => constraint.elementIds.includes(element.id));
  if (!relevant.length) {
    return 1;
  }
  const checks = relevant.map((constraint) => evaluateConstraint(constraint, matches));
  return Number((checks.reduce((sum, item) => sum + item, 0) / checks.length).toFixed(4));
}

function gradeForScore(score: number): ReconstructionElementScore["grade"] {
  if (score >= 0.93) {
    return "A";
  }
  if (score >= 0.87) {
    return "B";
  }
  if (score >= 0.78) {
    return "C";
  }
  if (score >= 0.68) {
    return "D";
  }
  return "F";
}

type ScoreWeights = {
  pixel: number;
  geometry: number;
  style: number;
  typography: number;
  alignment: number;
  editability: number;
};

function scoreWeightsForElement(element: ReconstructionElement): ScoreWeights {
  if (element.kind === "text") {
    return {
      pixel: 0.28,
      geometry: 0.18,
      style: 0.08,
      typography: 0.32,
      alignment: 0.12,
      editability: 0.1,
    };
  }
  if (element.kind === "icon" || element.kind === "primitive") {
    return {
      pixel: 0.3,
      geometry: 0.28,
      style: 0.22,
      typography: 0,
      alignment: 0.1,
      editability: 0.1,
    };
  }
  return {
    pixel: 0.32,
    geometry: 0.34,
    style: 0.18,
    typography: 0,
    alignment: 0.1,
    editability: 0.06,
  };
}

export async function buildReconstructionElementScores(options: {
  analysis: ReconstructionAnalysis;
  inspectedNodes: PluginNodeInspection[];
  referencePreviewDataUrl: string;
  renderedPreviewDataUrl: string | null;
  elementIds?: string[];
}) {
  const { elements, constraints } = collectReconstructionElements(options.analysis);
  const targetIds = options.elementIds?.length ? new Set(options.elementIds) : null;
  const scopedElements = targetIds
    ? elements.filter((element) => targetIds.has(element.id) || targetIds.has(element.analysisRefId || ""))
    : elements;
  const matches = matchReconstructionElementsToNodes(elements, options.inspectedNodes);
  const scores: ReconstructionElementScore[] = [];

  for (const element of scopedElements) {
    const matchedNode = matches.get(element.id) || null;
    const geometryScore = computeGeometryScore(element, matchedNode);
    const styleScore = computeStyleScore(element, matchedNode);
    const typographyScore = computeTypographyScore(element, matchedNode);
    const alignmentScore = computeAlignmentScore(element, constraints, matches);
    const editabilityScore = computeEditabilityScore(element, matchedNode);
    const pixelScore =
      options.renderedPreviewDataUrl
        ? (await measureElementDiff(
            options.referencePreviewDataUrl,
            options.renderedPreviewDataUrl,
            element.referenceBounds,
          )).compositeScore
        : 0;
    const weights = scoreWeightsForElement(element);
    const compositeScore = Number(
      (
        (weights.pixel * pixelScore) +
        (weights.geometry * geometryScore) +
        (weights.style * styleScore) +
        (weights.typography * typographyScore) +
        (weights.alignment * alignmentScore) +
        (weights.editability * editabilityScore)
      ).toFixed(4),
    );
    const hardFailures: string[] = [];
    const notes: string[] = [];
    if (!matchedNode) {
      hardFailures.push("missing-node");
      notes.push("No matching Figma node was found for this element.");
    }
    if (element.kind === "text" && element.content && matchedNode?.node.textContent !== element.content) {
      hardFailures.push("text-content-mismatch");
      notes.push(`Expected text "${element.content}" but found "${matchedNode?.node.textContent || "[missing]"}".`);
    }
    if (editabilityScore < 1) {
      hardFailures.push("not-fully-editable");
      notes.push("The matched node is not fully editable for this element type.");
    }
    if (geometryScore < 0.8) {
      notes.push("Geometry is still off. Recheck size, placement, and proportions before refining details.");
    }
    if (element.kind === "text" && typographyScore < 0.85) {
      notes.push("Typography is still off. Recheck font size, weight, alignment, and line structure.");
    }
    scores.push({
      elementId: element.id,
      elementName: element.name,
      kind: element.kind,
      inspectedNodeId: matchedNode?.node.id || null,
      matchStrategy: matchedNode?.strategy || "missing",
      referenceBounds: element.referenceBounds,
      targetBounds: matchedNode?.bounds || null,
      pixelScore,
      geometryScore,
      styleScore,
      typographyScore,
      alignmentScore,
      editabilityScore,
      compositeScore,
      grade: gradeForScore(compositeScore),
      hardFailures,
      notes,
    });
  }

  return scores.sort((left, right) => left.compositeScore - right.compositeScore);
}
