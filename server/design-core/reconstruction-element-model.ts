import type {
  ReconstructionAnalysis,
  ReconstructionBounds,
  ReconstructionDesignSurface,
  ReconstructionElement,
  ReconstructionElementConstraint,
  ReconstructionElementKind,
  ReconstructionSemanticNode,
  ReconstructionTextBlock,
  ReconstructionVectorPrimitive,
} from "../../shared/reconstruction.js";

function clamp01(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function clampNormalizedBounds(bounds: ReconstructionBounds): ReconstructionBounds {
  const x = clamp01(bounds.x);
  const y = clamp01(bounds.y);
  const right = clamp01(bounds.x + bounds.width);
  const bottom = clamp01(bounds.y + bounds.height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

function normalizeBounds(input: any): ReconstructionBounds {
  return clampNormalizedBounds({
    x: Number.isFinite(input?.x) ? Number(input.x) : 0,
    y: Number.isFinite(input?.y) ? Number(input.y) : 0,
    width: Number.isFinite(input?.width) ? Number(input.width) : 0,
    height: Number.isFinite(input?.height) ? Number(input.height) : 0,
  });
}

export function boundsArea(bounds: ReconstructionBounds) {
  return Math.max(0, bounds.width) * Math.max(0, bounds.height);
}

function boundsOverlap(left: ReconstructionBounds, right: ReconstructionBounds) {
  const x0 = Math.max(left.x, right.x);
  const y0 = Math.max(left.y, right.y);
  const x1 = Math.min(left.x + left.width, right.x + right.width);
  const y1 = Math.min(left.y + left.height, right.y + right.height);
  if (x1 <= x0 || y1 <= y0) {
    return 0;
  }
  return (x1 - x0) * (y1 - y0);
}

export function overlapRatio(left: ReconstructionBounds, right: ReconstructionBounds) {
  const overlap = boundsOverlap(left, right);
  if (overlap <= 0) {
    return 0;
  }
  return overlap / Math.max(0.0001, Math.min(boundsArea(left), boundsArea(right)));
}

export function getElementBounds(element: ReconstructionElement) {
  return clampNormalizedBounds(element.targetBounds || element.referenceBounds);
}

function kindForSemanticNode(node: ReconstructionSemanticNode): ReconstructionElementKind {
  return node.kind === "text"
    ? "text"
    : node.kind === "primitive"
      ? "primitive"
      : "group";
}

function buildContainingSurfaceLookup(analysis: ReconstructionAnalysis) {
  return analysis.designSurfaces
    .map((surface) => ({
      surface,
      area: boundsArea(surface.bounds),
    }))
    .sort((left, right) => left.area - right.area);
}

function findContainingSurfaceElementId(
  bounds: ReconstructionBounds,
  analysis: ReconstructionAnalysis,
  excludeSurfaceId?: string | null,
) {
  const lookup = buildContainingSurfaceLookup(analysis);
  const matched = lookup.find(({ surface }) => {
    if (excludeSurfaceId && surface.id === excludeSurfaceId) {
      return false;
    }
    return overlapRatio(surface.bounds, bounds) >= 0.9;
  });
  return matched ? `element/${matched.surface.id}` : null;
}

function buildSurfaceElement(surface: ReconstructionDesignSurface): ReconstructionElement {
  const normalizedBounds = clampNormalizedBounds(surface.bounds);
  return {
    id: `element/${surface.id}`,
    kind: "surface",
    editableKind: "frame",
    name: surface.name || surface.id,
    parentId: null,
    referenceBounds: normalizedBounds,
    targetBounds: normalizedBounds,
    analysisRefId: surface.id,
    content: null,
    surfaceRefId: surface.id,
    textRefId: null,
    primitiveRefId: null,
    status: "todo",
    inferred: surface.inferred,
    style: {
      fillHex: surface.fillHex,
      strokeHex: null,
      strokeWeight: null,
      opacity: surface.opacity,
      cornerRadius: surface.cornerRadius,
      fontFamily: null,
      fontStyle: null,
      fontWeight: null,
      fontSize: null,
      lineHeight: null,
      letterSpacing: null,
      alignment: null,
      layoutMode: null,
    },
  };
}

function buildTextElement(
  block: ReconstructionTextBlock,
  analysis: ReconstructionAnalysis,
): ReconstructionElement {
  const normalizedBounds = clampNormalizedBounds(block.bounds);
  return {
    id: `element/${block.id}`,
    kind: "text",
    editableKind: "text",
    name: block.content || block.id,
    parentId: findContainingSurfaceElementId(normalizedBounds, analysis),
    referenceBounds: normalizedBounds,
    targetBounds: normalizedBounds,
    analysisRefId: block.id,
    content: block.content,
    surfaceRefId: null,
    textRefId: block.id,
    primitiveRefId: null,
    status: "todo",
    inferred: block.inferred,
    style: {
      fillHex: block.colorHex,
      strokeHex: null,
      strokeWeight: null,
      opacity: 1,
      cornerRadius: null,
      fontFamily: block.fontFamily,
      fontStyle: block.fontStyle,
      fontWeight: block.fontWeight,
      fontSize: block.fontSize,
      lineHeight: block.lineHeight,
      letterSpacing: block.letterSpacing,
      alignment: block.alignment,
      layoutMode: null,
    },
  };
}

function buildPrimitiveElement(
  primitive: ReconstructionVectorPrimitive,
  analysis: ReconstructionAnalysis,
): ReconstructionElement | null {
  const normalizedBounds = primitive.bounds ? clampNormalizedBounds(primitive.bounds) : null;
  if (!normalizedBounds) {
    return null;
  }

  return {
    id: `element/${primitive.id}`,
    kind: primitive.kind === "svg" ? "icon" : "primitive",
    editableKind:
      primitive.kind === "line" || primitive.kind === "svg" ? "vector" : "shape",
    name: primitive.name || primitive.id,
    parentId: findContainingSurfaceElementId(normalizedBounds, analysis),
    referenceBounds: normalizedBounds,
    targetBounds: normalizedBounds,
    analysisRefId: primitive.id,
    content: null,
    surfaceRefId: null,
    textRefId: null,
    primitiveRefId: primitive.id,
    status: "todo",
    inferred: primitive.inferred,
    style: {
      fillHex: primitive.fillHex,
      strokeHex: primitive.strokeHex,
      strokeWeight: primitive.strokeWeight,
      opacity: primitive.opacity,
      cornerRadius: primitive.cornerRadius,
      fontFamily: null,
      fontStyle: null,
      fontWeight: null,
      fontSize: null,
      lineHeight: null,
      letterSpacing: null,
      alignment: null,
      layoutMode: null,
    },
  };
}

function buildGroupElement(node: ReconstructionSemanticNode): ReconstructionElement {
  const normalizedBounds = clampNormalizedBounds(node.bounds);
  return {
    id: `element/${node.id}`,
    kind: kindForSemanticNode(node),
    editableKind: node.kind === "text" ? "text" : node.kind === "primitive" ? "vector" : "group",
    name: node.name,
    parentId: node.parentId ? `element/${node.parentId}` : null,
    referenceBounds: normalizedBounds,
    targetBounds: normalizedBounds,
    analysisRefId: node.id,
    content: null,
    surfaceRefId: node.surfaceRefId,
    textRefId: node.textRefId,
    primitiveRefId: node.primitiveRefId,
    status: "todo",
    inferred: node.inferred,
    style: {
      fillHex: node.fillHex,
      strokeHex: null,
      strokeWeight: null,
      opacity: 1,
      cornerRadius: node.cornerRadius,
      fontFamily: null,
      fontStyle: null,
      fontWeight: null,
      fontSize: null,
      lineHeight: null,
      letterSpacing: null,
      alignment: null,
      layoutMode: node.layoutMode,
    },
  };
}

export function synthesizeReconstructionElements(
  analysis: ReconstructionAnalysis,
): ReconstructionElement[] {
  const elements: ReconstructionElement[] = [];
  const claimedIds = new Set<string>();

  for (const surface of analysis.designSurfaces) {
    elements.push(buildSurfaceElement(surface));
    claimedIds.add(surface.id);
  }

  for (const block of analysis.textBlocks) {
    elements.push(buildTextElement(block, analysis));
    claimedIds.add(block.id);
  }

  for (const primitive of analysis.vectorPrimitives) {
    const element = buildPrimitiveElement(primitive, analysis);
    if (!element) {
      continue;
    }
    elements.push(element);
    claimedIds.add(primitive.id);
  }

  for (const node of analysis.semanticNodes) {
    if (node.kind === "screen-root" || claimedIds.has(node.id)) {
      continue;
    }
    if (node.surfaceRefId && claimedIds.has(node.surfaceRefId)) {
      continue;
    }
    if (node.textRefId && claimedIds.has(node.textRefId)) {
      continue;
    }
    if (node.primitiveRefId && claimedIds.has(node.primitiveRefId)) {
      continue;
    }
    elements.push(buildGroupElement(node));
  }

  return elements.sort((left, right) => {
    const leftBounds = getElementBounds(left);
    const rightBounds = getElementBounds(right);
    if (Math.abs(leftBounds.y - rightBounds.y) > 0.005) {
      return leftBounds.y - rightBounds.y;
    }
    if (Math.abs(leftBounds.x - rightBounds.x) > 0.005) {
      return leftBounds.x - rightBounds.x;
    }
    return left.name.localeCompare(right.name);
  });
}

function makeConstraintId(prefix: string, elementIds: string[]) {
  return `${prefix}/${elementIds.join("+")}`;
}

export function synthesizeReconstructionElementConstraints(
  elements: ReconstructionElement[],
): ReconstructionElementConstraint[] {
  const constraints: ReconstructionElementConstraint[] = [];
  const byParent = new Map<string, ReconstructionElement[]>();
  for (const element of elements) {
    if (!element.parentId) {
      continue;
    }
    const bucket = byParent.get(element.parentId) || [];
    bucket.push(element);
    byParent.set(element.parentId, bucket);
  }

  for (const element of elements) {
    if (element.parentId) {
      constraints.push({
        id: makeConstraintId("same-parent", [element.parentId, element.id]),
        kind: "same-parent",
        elementIds: [element.parentId, element.id],
        axis: null,
        targetValue: null,
        tolerance: null,
        hard: true,
        inferred: true,
        description: `${element.name} should remain grouped under ${element.parentId}.`,
      });
    }
  }

  for (const siblings of byParent.values()) {
    for (let index = 0; index < siblings.length; index += 1) {
      for (let cursor = index + 1; cursor < siblings.length; cursor += 1) {
        const left = siblings[index];
        const right = siblings[cursor];
        const leftBounds = getElementBounds(left);
        const rightBounds = getElementBounds(right);
        const edgeTolerance = 0.015;
        if (Math.abs(leftBounds.y - rightBounds.y) <= edgeTolerance) {
          constraints.push({
            id: makeConstraintId("align-top", [left.id, right.id]),
            kind: "align-top",
            elementIds: [left.id, right.id],
            axis: "y",
            targetValue: Number(((leftBounds.y + rightBounds.y) / 2).toFixed(4)),
            tolerance: edgeTolerance,
            hard: true,
            inferred: true,
            description: `${left.name} and ${right.name} should share the same top edge.`,
          });
        }
        if (Math.abs((leftBounds.x + leftBounds.width) - (rightBounds.x + rightBounds.width)) <= edgeTolerance) {
          constraints.push({
            id: makeConstraintId("align-right", [left.id, right.id]),
            kind: "align-right",
            elementIds: [left.id, right.id],
            axis: "x",
            targetValue: Number(
              (((leftBounds.x + leftBounds.width) + (rightBounds.x + rightBounds.width)) / 2).toFixed(4),
            ),
            tolerance: edgeTolerance,
            hard: true,
            inferred: true,
            description: `${left.name} and ${right.name} should share the same right edge.`,
          });
        }
        if (
          left.kind === "text" &&
          right.kind === "text" &&
          left.style.fontSize !== null &&
          right.style.fontSize !== null &&
          Math.abs(left.style.fontSize - right.style.fontSize) <= 1 &&
          Math.abs((left.style.fontWeight || 0) - (right.style.fontWeight || 0)) <= 120
        ) {
          constraints.push({
            id: makeConstraintId("share-typography", [left.id, right.id]),
            kind: "share-typography",
            elementIds: [left.id, right.id],
            axis: null,
            targetValue: left.style.fontSize,
            tolerance: 1,
            hard: true,
            inferred: true,
            description: `${left.name} and ${right.name} should share the same typography scale.`,
          });
        }
        if (
          left.kind === "text" &&
          right.kind === "text" &&
          Math.abs((leftBounds.y + leftBounds.height) - (rightBounds.y + rightBounds.height)) <= edgeTolerance
        ) {
          constraints.push({
            id: makeConstraintId("share-baseline", [left.id, right.id]),
            kind: "share-baseline",
            elementIds: [left.id, right.id],
            axis: "y",
            targetValue: Number(
              (((leftBounds.y + leftBounds.height) + (rightBounds.y + rightBounds.height)) / 2).toFixed(4),
            ),
            tolerance: edgeTolerance,
            hard: false,
            inferred: true,
            description: `${left.name} and ${right.name} should visually share a baseline.`,
          });
        }
      }
    }
  }

  return constraints;
}

export function normalizeReconstructionElements(input: unknown): ReconstructionElement[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item, index) => {
      const kind =
        item?.kind === "surface" ||
        item?.kind === "text" ||
        item?.kind === "icon" ||
        item?.kind === "primitive" ||
        item?.kind === "group"
          ? item.kind
          : "group";
      const editableKind =
        item?.editableKind === "frame" ||
        item?.editableKind === "text" ||
        item?.editableKind === "shape" ||
        item?.editableKind === "vector" ||
        item?.editableKind === "group"
          ? item.editableKind
          : kind === "text"
            ? "text"
            : kind === "surface"
              ? "frame"
              : kind === "group"
                ? "group"
                : "vector";
      const status =
        item?.status === "drawing" ||
        item?.status === "review" ||
        item?.status === "locked"
          ? item.status
          : "todo";
      return {
        id: typeof item?.id === "string" && item.id.trim() ? item.id.trim() : `element-${index + 1}`,
        kind,
        editableKind,
        name:
          typeof item?.name === "string" && item.name.trim() ? item.name.trim() : `Element ${index + 1}`,
        parentId:
          typeof item?.parentId === "string" && item.parentId.trim() ? item.parentId.trim() : null,
        referenceBounds: normalizeBounds(item?.referenceBounds || item?.bounds),
        targetBounds:
          item?.targetBounds || item?.bounds ? normalizeBounds(item?.targetBounds || item?.bounds) : null,
        analysisRefId:
          typeof item?.analysisRefId === "string" && item.analysisRefId.trim()
            ? item.analysisRefId.trim()
            : null,
        content:
          typeof item?.content === "string" && item.content.trim() ? item.content.trim() : null,
        surfaceRefId:
          typeof item?.surfaceRefId === "string" && item.surfaceRefId.trim()
            ? item.surfaceRefId.trim()
            : null,
        textRefId:
          typeof item?.textRefId === "string" && item.textRefId.trim() ? item.textRefId.trim() : null,
        primitiveRefId:
          typeof item?.primitiveRefId === "string" && item.primitiveRefId.trim()
            ? item.primitiveRefId.trim()
            : null,
        status,
        inferred: Boolean(item?.inferred),
        style: {
          fillHex: typeof item?.style?.fillHex === "string" ? item.style.fillHex.toUpperCase() : null,
          strokeHex:
            typeof item?.style?.strokeHex === "string" ? item.style.strokeHex.toUpperCase() : null,
          strokeWeight:
            Number.isFinite(item?.style?.strokeWeight) ? Number(item.style.strokeWeight) : null,
          opacity: Number.isFinite(item?.style?.opacity) ? Number(item.style.opacity) : null,
          cornerRadius:
            Number.isFinite(item?.style?.cornerRadius) ? Number(item.style.cornerRadius) : null,
          fontFamily:
            typeof item?.style?.fontFamily === "string" && item.style.fontFamily.trim()
              ? item.style.fontFamily.trim()
              : null,
          fontStyle:
            typeof item?.style?.fontStyle === "string" && item.style.fontStyle.trim()
              ? item.style.fontStyle.trim()
              : null,
          fontWeight:
            Number.isFinite(item?.style?.fontWeight) ? Number(item.style.fontWeight) : null,
          fontSize: Number.isFinite(item?.style?.fontSize) ? Number(item.style.fontSize) : null,
          lineHeight:
            Number.isFinite(item?.style?.lineHeight) ? Number(item.style.lineHeight) : null,
          letterSpacing:
            Number.isFinite(item?.style?.letterSpacing) ? Number(item.style.letterSpacing) : null,
          alignment:
            item?.style?.alignment === "center" ||
            item?.style?.alignment === "right" ||
            item?.style?.alignment === "justified"
              ? item.style.alignment
              : item?.style?.alignment === "left"
                ? "left"
                : null,
          layoutMode:
            item?.style?.layoutMode === "HORIZONTAL" || item?.style?.layoutMode === "VERTICAL"
              ? item.style.layoutMode
              : item?.style?.layoutMode === "NONE"
                ? "NONE"
                : null,
        },
      } satisfies ReconstructionElement;
    })
    .filter((element) => element.referenceBounds.width > 0 && element.referenceBounds.height > 0)
    .slice(0, 160);
}

export function normalizeReconstructionElementConstraints(
  input: unknown,
  elements: ReconstructionElement[],
): ReconstructionElementConstraint[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const validElementIds = new Set(elements.map((element) => element.id));
  return input
    .map((item, index) => ({
      id:
        typeof item?.id === "string" && item.id.trim()
          ? item.id.trim()
          : `constraint-${index + 1}`,
      kind:
        item?.kind === "align-top" ||
        item?.kind === "align-bottom" ||
        item?.kind === "align-left" ||
        item?.kind === "align-right" ||
        item?.kind === "share-baseline" ||
        item?.kind === "share-typography" ||
        item?.kind === "same-parent" ||
        item?.kind === "padding-lock"
          ? item.kind
          : "same-parent",
      elementIds: Array.isArray(item?.elementIds)
        ? item.elementIds.filter(
            (value: unknown): value is string =>
              typeof value === "string" &&
              Boolean(value.trim()) &&
              validElementIds.has(value.trim()),
          )
        : [],
      axis:
        item?.axis === "x" || item?.axis === "y" || item?.axis === "both" ? item.axis : null,
      targetValue: Number.isFinite(item?.targetValue) ? Number(item.targetValue) : null,
      tolerance: Number.isFinite(item?.tolerance) ? Number(item.tolerance) : null,
      hard: item?.hard !== false,
      inferred: Boolean(item?.inferred),
      description:
        typeof item?.description === "string" && item.description.trim()
          ? item.description.trim()
          : `Constraint ${index + 1}`,
    }))
    .filter((constraint) => constraint.elementIds.length >= 1)
    .slice(0, 240);
}

export function collectReconstructionElements(analysis: ReconstructionAnalysis) {
  const elements =
    analysis.elements && analysis.elements.length > 0
      ? analysis.elements
      : synthesizeReconstructionElements(analysis);
  const constraints =
    analysis.elementConstraints && analysis.elementConstraints.length > 0
      ? analysis.elementConstraints
      : synthesizeReconstructionElementConstraints(elements);
  return { elements, constraints };
}
