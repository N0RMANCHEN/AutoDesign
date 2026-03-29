import type { FigmaPluginCommandBatch, FigmaCapabilityCommand } from "./plugin-contract.js";
import type {
  CodeToDesignRuntimeSnapshot,
  CodeToDesignNodeSnapshot,
  CodeToDesignRect,
} from "./code-to-design-snapshot.js";
import { listResponsiveVariants } from "./code-to-design-snapshot.js";
import {
  buildCodeToDesignQualityReport,
  type CodeToDesignQualityReport,
} from "./code-to-design-quality.js";

export type CodeToDesignImageStrategy = "node" | "frame_raster";
export type CodeToDesignTextRasterOverride = {
  dataUrl: string;
  fitMode?: "cover" | "contain" | "stretch";
  cornerRadius?: number;
};
export type CodeToDesignLayoutMode = "NONE" | "HORIZONTAL" | "VERTICAL";
export type CodeToDesignLayoutNodeKind = "frame" | "text" | "image" | "line" | "svg";

export type CodeToDesignLayoutNode = {
  id: string;
  kind: CodeToDesignLayoutNodeKind;
  name: string;
  rect: CodeToDesignRect;
  parentId: string | null;
  sourceNodeIds: string[];
  children: CodeToDesignLayoutNode[];
  layout?: {
    mode: CodeToDesignLayoutMode;
    layoutWrap?: "NO_WRAP" | "WRAP";
    itemSpacing?: number;
    counterAxisSpacing?: number;
    paddingLeft?: number;
    paddingRight?: number;
    paddingTop?: number;
    paddingBottom?: number;
    primaryAxisSizingMode?: "FIXED" | "AUTO";
    counterAxisSizingMode?: "FIXED" | "AUTO";
    primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
    counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
    clipsContent?: boolean;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
  };
  layoutChild?: {
    layoutAlign?: "INHERIT" | "STRETCH" | "MIN" | "CENTER" | "MAX";
    layoutGrow?: number;
    layoutPositioning?: "AUTO" | "ABSOLUTE";
  };
  responsiveRules?: Array<{
    viewportKey: string;
    rect: CodeToDesignRect;
  }>;
  fillHex?: string;
  fillOpacity?: number;
  cornerRadius?: number;
  textContent?: string;
  textStyle?: {
    fontFamily: string;
    fontFamilyCandidates: string[];
    fontStyle?: string;
    fontSize: number;
    fontWeight: number | string;
    colorHex?: string;
    lineHeight?: number;
    letterSpacing?: number;
    alignment?: "left" | "center" | "right" | "justified";
    textAutoResize?: "WIDTH_AND_HEIGHT" | "HEIGHT" | "NONE";
    resolvedBrowserFontFamily?: string | null;
    resolvedBrowserFontStyle?: string | null;
  };
  image?: {
    dataUrl: string;
    fitMode: "cover" | "contain" | "stretch";
    cornerRadius?: number;
  };
  svgMarkup?: string;
  line?: {
    strokeHex?: string;
    strokeWeight?: number;
    opacity?: number;
    rotation?: number;
  };
  absolute?: boolean;
  unsupportedFeatures?: string[];
};

export type CodeToDesignPlan = {
  batch: FigmaPluginCommandBatch;
  summary: {
    commandCount: number;
    frameCommandCount: number;
    layoutCommandCount: number;
    textCommandCount: number;
    imageCommandCount: number;
    shapeCommandCount: number;
  };
  warnings: string[];
  layoutTree: CodeToDesignLayoutNode;
  qualityReport: CodeToDesignQualityReport;
};

type ParsedColor = {
  hex: string;
  opacity: number;
};

type ParsedLinearGradient = {
  angle: number;
  stops: Array<{ offset: number; color: ParsedColor }>;
};

type SnapshotIndex = {
  byId: Map<string, CodeToDesignNodeSnapshot>;
  childrenByParentId: Map<string | null, CodeToDesignNodeSnapshot[]>;
};

const DOM_TAG_NAME_PATTERN = /^(?:div|span|section|aside|figure|header|main|p|img|h[1-6]|figcaption)$/i;
const EDITORIAL_REQUIRED_CONTAINERS = [
  "Folio Bar",
  "Editorial Shell",
  "Opening Spread",
  "Opening Copy",
  "Hero Figure",
  "Side Rail",
  "Side Note",
  "Supporting Block",
  "Supporting Intro",
  "Supporting Grid",
  "Look Rail",
  "Look Rail Intro",
  "Look Rail Images",
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function compareNodes(left: CodeToDesignNodeSnapshot, right: CodeToDesignNodeSnapshot) {
  const yOrder = left.rect.y - right.rect.y;
  if (Math.abs(yOrder) > 0.1) {
    return yOrder;
  }
  const xOrder = left.rect.x - right.rect.x;
  if (Math.abs(xOrder) > 0.1) {
    return xOrder;
  }
  return left.domPath.localeCompare(right.domPath);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeNodeClassName(node: Pick<CodeToDesignNodeSnapshot, "className">) {
  return typeof node.className === "string" && node.className.trim() ? node.className.trim() : null;
}

function nodeClassList(node: Pick<CodeToDesignNodeSnapshot, "className">) {
  return uniqueStrings((normalizeNodeClassName(node) || "").split(/\s+/g));
}

function hasClass(node: Pick<CodeToDesignNodeSnapshot, "className">, className: string) {
  return nodeClassList(node).includes(className);
}

function parseCssNumber(value: string, fallback = 0) {
  const numeric = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function parseCssPx(value: string | undefined, fallback = 0) {
  const match = /^(-?\d*\.?\d+)px$/i.exec(String(value || "").trim());
  return match ? Number(match[1]) : fallback;
}

export function parseCssFontFamilies(value: string | undefined) {
  return uniqueStrings(
    String(value || "")
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, "")),
  );
}

export function parseCssFontFamily(value: string | undefined) {
  const family = parseCssFontFamilies(value)[0];
  return family || "Inter";
}

function normalizeTextAlignment(value: string | undefined) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "center" || normalized === "right" || normalized === "justified") {
    return normalized;
  }
  return "left";
}

function inferTextAutoResize(node: Pick<CodeToDesignNodeSnapshot, "rect" | "textContent" | "styles">) {
  const text = String(node.textContent || "").trim();
  if (!text) {
    return "NONE" as const;
  }
  const fontSize = parseCssPx(node.styles.fontSize, 16);
  const lineHeight = parseCssPx(node.styles.lineHeight, 0) || fontSize * 1.2;
  const multiLineByHeight = node.rect.height > lineHeight * 1.35;
  const longFormText = text.length >= 24 || /[。！？,.]/.test(text);
  return multiLineByHeight || longFormText ? "HEIGHT" : "NONE";
}

function readFontFamilies(node: Pick<CodeToDesignNodeSnapshot, "fontFamilyCandidates" | "styles">) {
  return uniqueStrings([
    ...(node.fontFamilyCandidates || []),
    ...parseCssFontFamilies(node.styles.fontFamily),
  ]);
}

function normalizeSemanticName(value: string, fallback: string) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || fallback;
}

function semanticNameFromLabel(prefix: string, label: string, fallback: string) {
  const normalizedLabel = normalizeSemanticName(label, fallback)
    .replace(/[^\w\s/-]+/g, "")
    .trim();
  return normalizedLabel ? `${prefix} / ${normalizedLabel}` : `${prefix} / ${fallback}`;
}

export function parseCssColor(value: string | undefined): ParsedColor | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "transparent" || raw === "rgba(0, 0, 0, 0)") {
    return null;
  }

  const hexMatch = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw);
  if (hexMatch) {
    const opacity = hexMatch[2] ? round(parseInt(hexMatch[2], 16) / 255) : 1;
    return {
      hex: `#${hexMatch[1].toUpperCase()}`,
      opacity,
    };
  }

  const rgbMatch =
    /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,\/]+([0-9.]+))?\s*\)$/i.exec(raw);
  if (!rgbMatch) {
    return null;
  }

  const [red, green, blue] = rgbMatch.slice(1, 4).map((part) => clamp(Number(part), 0, 255));
  const opacity = rgbMatch[4] === undefined ? 1 : clamp(Number(rgbMatch[4]), 0, 1);
  return {
    hex: `#${[red, green, blue].map((part) => part.toString(16).padStart(2, "0").toUpperCase()).join("")}`,
    opacity: round(opacity),
  };
}

function parseGradientColorStop(segment: string) {
  const stopMatch = /^(rgba?\([^)]*\)|#[0-9a-fA-F]{6,8})(?:\s+(-?\d*\.?\d+)%)?$/i.exec(segment);
  if (!stopMatch) {
    return null;
  }
  const color = parseCssColor(stopMatch[1]);
  if (!color) {
    return null;
  }
  return {
    color,
    offset: stopMatch[2] === undefined ? null : clamp(Number(stopMatch[2]) / 100, 0, 1),
  };
}

function fillImplicitGradientOffsets(
  stops: Array<{ color: ParsedColor; offset: number | null }>,
): ParsedLinearGradient["stops"] {
  if (!stops.length) {
    return [];
  }

  const resolved = stops.map((stop) => ({ ...stop }));
  if (resolved[0]?.offset === null) {
    resolved[0].offset = 0;
  }
  if (resolved[resolved.length - 1]?.offset === null) {
    resolved[resolved.length - 1].offset = 1;
  }

  let index = 0;
  while (index < resolved.length) {
    if (resolved[index]?.offset !== null) {
      index += 1;
      continue;
    }

    let endIndex = index;
    while (endIndex < resolved.length && resolved[endIndex]?.offset === null) {
      endIndex += 1;
    }

    const startOffset = resolved[index - 1]?.offset ?? 0;
    const endOffset = resolved[endIndex]?.offset ?? startOffset;
    const span = endIndex - index + 1;
    for (let cursor = index; cursor < endIndex; cursor += 1) {
      const ratio = (cursor - index + 1) / span;
      resolved[cursor].offset = round(startOffset + (endOffset - startOffset) * ratio);
    }
    index = endIndex + 1;
  }

  return resolved.map((stop) => ({
    color: stop.color,
    offset: clamp(stop.offset ?? 0, 0, 1),
  }));
}

export function parseSimpleLinearGradient(value: string | undefined): ParsedLinearGradient | null {
  const raw = String(value || "").trim();
  if (!raw.startsWith("linear-gradient(") || !raw.endsWith(")")) {
    return null;
  }

  const content = raw.slice("linear-gradient(".length, -1);
  const segments = content
    .split(/,(?![^(]*\))/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  let angle = 180;
  const firstStop = parseGradientColorStop(segments[0]!);
  if (!firstStop) {
    const angleMatch = /^(-?\d*\.?\d+)deg$/i.exec(segments.shift()!);
    if (!angleMatch) {
      return null;
    }
    angle = Number(angleMatch[1]);
  }

  const stops = fillImplicitGradientOffsets(
    segments
      .map((segment) => parseGradientColorStop(segment))
      .filter(Boolean) as Array<{ color: ParsedColor; offset: number | null }>,
  );

  return stops.length >= 2
    ? {
        angle,
        stops,
      }
    : null;
}

export function buildGradientSvg(params: {
  width: number;
  height: number;
  gradient: ParsedLinearGradient;
}) {
  const angleRadians = ((params.gradient.angle - 90) * Math.PI) / 180;
  const x1 = round(50 - Math.cos(angleRadians) * 50);
  const y1 = round(50 - Math.sin(angleRadians) * 50);
  const x2 = round(50 + Math.cos(angleRadians) * 50);
  const y2 = round(50 + Math.sin(angleRadians) * 50);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${params.width}" height="${params.height}" viewBox="0 0 ${params.width} ${params.height}">`,
    `<defs><linearGradient id="autodesignGradient" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">`,
    ...params.gradient.stops.map(
      (stop) =>
        `<stop offset="${round(stop.offset * 100)}%" stop-color="${stop.color.hex}" stop-opacity="${stop.color.opacity}"/>`,
    ),
    "</linearGradient></defs>",
    `<rect x="0" y="0" width="${params.width}" height="${params.height}" fill="url(#autodesignGradient)"/>`,
    "</svg>",
  ].join("");
}

function buildSnapshotIndex(snapshot: CodeToDesignRuntimeSnapshot): SnapshotIndex {
  const byId = new Map<string, CodeToDesignNodeSnapshot>();
  const childrenByParentId = new Map<string | null, CodeToDesignNodeSnapshot[]>();
  for (const node of snapshot.nodes) {
    byId.set(node.id, node);
    const bucket = childrenByParentId.get(node.parentId) || [];
    bucket.push(node);
    childrenByParentId.set(node.parentId, bucket);
  }
  for (const bucket of childrenByParentId.values()) {
    bucket.sort(compareNodes);
  }
  return { byId, childrenByParentId };
}

function getChildren(index: SnapshotIndex, parentId: string | null) {
  return [...(index.childrenByParentId.get(parentId) || [])];
}

function walkDescendants(index: SnapshotIndex, parentId: string | null): CodeToDesignNodeSnapshot[] {
  const descendants: CodeToDesignNodeSnapshot[] = [];
  const stack = getChildren(index, parentId);
  while (stack.length) {
    const node = stack.shift()!;
    descendants.push(node);
    stack.unshift(...getChildren(index, node.id));
  }
  return descendants;
}

function findFirstNodeByClass(index: SnapshotIndex, className: string, parentId: string | null = null) {
  const nodes = parentId === null ? [...index.byId.values()] : walkDescendants(index, parentId);
  return nodes.find((node) => hasClass(node, className)) || null;
}

function findDirectChildByClass(index: SnapshotIndex, parentId: string, className: string) {
  return getChildren(index, parentId).find((node) => hasClass(node, className)) || null;
}

function findFirstNode(
  index: SnapshotIndex,
  parentId: string,
  predicate: (node: CodeToDesignNodeSnapshot) => boolean,
) {
  return walkDescendants(index, parentId).find(predicate) || null;
}

function findTextNodeByClass(index: SnapshotIndex, parentId: string, className: string) {
  return findFirstNode(index, parentId, (node) => node.role === "text" && hasClass(node, className));
}

function findFirstTextByTag(index: SnapshotIndex, parentId: string, tagName: string) {
  return findFirstNode(index, parentId, (node) => node.role === "text" && node.tagName === tagName);
}

function findFirstImageNode(index: SnapshotIndex, parentId: string) {
  return findFirstNode(index, parentId, (node) => node.role === "image" && Boolean(node.image?.dataUrl));
}

function collectTextNodes(index: SnapshotIndex, parentId: string) {
  return walkDescendants(index, parentId).filter((node) => node.role === "text");
}

function unionRects(rects: CodeToDesignRect[]): CodeToDesignRect {
  if (!rects.length) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: round(minX),
    y: round(minY),
    width: round(maxX - minX),
    height: round(maxY - minY),
  };
}

function gapBetween(previousRect: CodeToDesignRect, nextRect: CodeToDesignRect, axis: "x" | "y") {
  if (axis === "x") {
    return round(Math.max(0, nextRect.x - (previousRect.x + previousRect.width)));
  }
  return round(Math.max(0, nextRect.y - (previousRect.y + previousRect.height)));
}

function measureStackGap(children: CodeToDesignLayoutNode[], axis: "x" | "y") {
  if (children.length < 2) {
    return 0;
  }
  const firstGap = gapBetween(children[0]!.rect, children[1]!.rect, axis);
  return Number.isFinite(firstGap) ? firstGap : 0;
}

function countRectTracks(rects: CodeToDesignRect[], axis: "x" | "y", tolerance = 4) {
  const positions = rects
    .map((rect) => round(axis === "x" ? rect.x : rect.y))
    .sort((left, right) => left - right);
  let trackCount = 0;
  let previousPosition: number | null = null;
  for (const position of positions) {
    if (previousPosition === null || Math.abs(position - previousPosition) > tolerance) {
      trackCount += 1;
      previousPosition = position;
    }
  }
  return trackCount;
}

function countNodeTracks(nodes: Array<{ rect: CodeToDesignRect }>, axis: "x" | "y", tolerance = 4) {
  return countRectTracks(
    nodes.map((node) => node.rect),
    axis,
    tolerance,
  );
}

function usesSingleColumnLayout(nodes: Array<{ rect: CodeToDesignRect }>, tolerance = 4) {
  return countNodeTracks(nodes, "x", tolerance) <= 1;
}

function usesMultipleRows(nodes: Array<{ rect: CodeToDesignRect }>, tolerance = 4) {
  return countNodeTracks(nodes, "y", tolerance) > 1;
}

function resolveChildrenRect(children: CodeToDesignLayoutNode[], fallbackRect: CodeToDesignRect) {
  return children.length ? unionRects(children.map((child) => child.rect)) : fallbackRect;
}

function inferWidthLayoutAlign(childRect: CodeToDesignRect, parentRect: CodeToDesignRect, tolerance = 4) {
  return childRect.width >= parentRect.width - tolerance ? "STRETCH" : "MIN";
}

function buildResponsiveRules(
  snapshot: CodeToDesignRuntimeSnapshot,
  sourceNodeIds: string[],
  fallbackRect: CodeToDesignRect,
) {
  const variants = listResponsiveVariants(snapshot);
  if (variants.length <= 1 || !sourceNodeIds.length) {
    return undefined;
  }
  const rules = variants.map((variant) => {
    const matchedNodes = variant.nodes.filter((node) => sourceNodeIds.includes(node.id));
    return {
      viewportKey: variant.viewportKey,
      rect: matchedNodes.length ? unionRects(matchedNodes.map((node) => node.rect)) : fallbackRect,
    };
  });
  return rules.length ? rules : undefined;
}

function attachResponsiveRules(snapshot: CodeToDesignRuntimeSnapshot, node: CodeToDesignLayoutNode) {
  node.responsiveRules = buildResponsiveRules(snapshot, node.sourceNodeIds, node.rect);
  if (node.kind === "frame" && node.layout && node.responsiveRules?.length) {
    const widths = node.responsiveRules.map((rule) => rule.rect.width).filter((value) => value > 0);
    const heights = node.responsiveRules.map((rule) => rule.rect.height).filter((value) => value > 0);
    if (widths.length) {
      node.layout.minWidth = Math.min(...widths);
      node.layout.maxWidth = Math.max(...widths);
    }
    if (heights.length) {
      node.layout.minHeight = Math.min(...heights);
      node.layout.maxHeight = Math.max(...heights);
    }
  }
  for (const child of node.children) {
    attachResponsiveRules(snapshot, child);
  }
}

function buildLayoutNode(params: Omit<CodeToDesignLayoutNode, "children"> & { children?: CodeToDesignLayoutNode[] }): CodeToDesignLayoutNode {
  return {
    ...params,
    children: [...(params.children || [])],
  };
}

function buildFrameNode(params: {
  id: string;
  name: string;
  rect: CodeToDesignRect;
  parentId: string | null;
  sourceNodeIds?: string[];
  children?: CodeToDesignLayoutNode[];
  layout?: CodeToDesignLayoutNode["layout"];
  layoutChild?: CodeToDesignLayoutNode["layoutChild"];
  responsiveRules?: CodeToDesignLayoutNode["responsiveRules"];
  fillHex?: string;
  fillOpacity?: number;
  cornerRadius?: number;
  absolute?: boolean;
  unsupportedFeatures?: string[];
}) {
  return buildLayoutNode({
    id: params.id,
    kind: "frame",
    name: params.name,
    rect: params.rect,
    parentId: params.parentId,
    sourceNodeIds: params.sourceNodeIds || [],
    children: params.children,
    layout: params.layout,
    layoutChild: params.layoutChild,
    responsiveRules: params.responsiveRules,
    fillHex: params.fillHex,
    fillOpacity: params.fillOpacity,
    cornerRadius: params.cornerRadius,
    absolute: params.absolute,
    unsupportedFeatures: params.unsupportedFeatures,
  });
}

function buildTextNode(params: {
  id: string;
  name: string;
  rect: CodeToDesignRect;
  parentId: string;
  sourceNode: CodeToDesignNodeSnapshot;
  layoutChild?: CodeToDesignLayoutNode["layoutChild"];
}) {
  const textColor = parseCssColor(params.sourceNode.styles.color);
  const fontFamilies = readFontFamilies(params.sourceNode);
  return buildLayoutNode({
    id: params.id,
    kind: "text",
    name: params.name,
    rect: params.rect,
    parentId: params.parentId,
    sourceNodeIds: [params.sourceNode.id],
    layoutChild: params.layoutChild,
    textContent: params.sourceNode.textContent || "",
    textStyle: {
      fontFamily: fontFamilies[0] || "Inter",
      fontFamilyCandidates: fontFamilies,
      fontStyle: params.sourceNode.resolvedBrowserFontStyle || params.sourceNode.styles.fontStyle || undefined,
      fontSize: parseCssPx(params.sourceNode.styles.fontSize, 16),
      fontWeight: Number(params.sourceNode.styles.fontWeight) || params.sourceNode.styles.fontWeight || 400,
      colorHex: textColor?.hex,
      lineHeight: parseCssPx(params.sourceNode.styles.lineHeight, 0) || undefined,
      letterSpacing:
        params.sourceNode.styles.letterSpacing === "normal"
          ? undefined
          : parseCssPx(params.sourceNode.styles.letterSpacing, 0),
      alignment: normalizeTextAlignment(params.sourceNode.styles.textAlign),
      textAutoResize: inferTextAutoResize(params.sourceNode),
      resolvedBrowserFontFamily: params.sourceNode.resolvedBrowserFontFamily || null,
      resolvedBrowserFontStyle: params.sourceNode.resolvedBrowserFontStyle || null,
    },
  });
}

function buildImageNode(params: {
  id: string;
  name: string;
  rect: CodeToDesignRect;
  parentId: string;
  sourceNode: CodeToDesignNodeSnapshot;
  layoutChild?: CodeToDesignLayoutNode["layoutChild"];
}) {
  if (!params.sourceNode.image?.dataUrl) {
    return null;
  }
  return buildLayoutNode({
    id: params.id,
    kind: "image",
    name: params.name,
    rect: params.rect,
    parentId: params.parentId,
    sourceNodeIds: [params.sourceNode.id],
    layoutChild: params.layoutChild,
    image: {
      dataUrl: params.sourceNode.image.dataUrl,
      fitMode:
        params.sourceNode.styles.objectFit === "contain" || params.sourceNode.styles.objectFit === "stretch"
          ? params.sourceNode.styles.objectFit
          : "cover",
      cornerRadius: Math.max(
        parseCssPx(params.sourceNode.styles.borderTopLeftRadius, 0),
        parseCssPx(params.sourceNode.styles.borderTopRightRadius, 0),
        parseCssPx(params.sourceNode.styles.borderBottomLeftRadius, 0),
        parseCssPx(params.sourceNode.styles.borderBottomRightRadius, 0),
      ),
    },
  });
}

function buildLineNode(params: {
  id: string;
  name: string;
  rect: CodeToDesignRect;
  parentId: string;
  strokeHex?: string;
  strokeWeight?: number;
  opacity?: number;
  absolute?: boolean;
  layoutChild?: CodeToDesignLayoutNode["layoutChild"];
}) {
  return buildLayoutNode({
    id: params.id,
    kind: "line",
    name: params.name,
    rect: params.rect,
    parentId: params.parentId,
    sourceNodeIds: [],
    absolute: params.absolute,
    layoutChild: params.layoutChild,
    line: {
      strokeHex: params.strokeHex,
      strokeWeight: params.strokeWeight,
      opacity: params.opacity,
    },
  });
}

function buildSvgNode(params: {
  id: string;
  name: string;
  rect: CodeToDesignRect;
  parentId: string;
  svgMarkup: string;
  absolute?: boolean;
  sourceNodeIds?: string[];
  layoutChild?: CodeToDesignLayoutNode["layoutChild"];
}) {
  return buildLayoutNode({
    id: params.id,
    kind: "svg",
    name: params.name,
    rect: params.rect,
    parentId: params.parentId,
    sourceNodeIds: params.sourceNodeIds || [],
    svgMarkup: params.svgMarkup,
    absolute: params.absolute,
    layoutChild: params.layoutChild,
  });
}

function applyTextRasterOverrides(
  node: CodeToDesignLayoutNode,
  overrides: Record<string, CodeToDesignTextRasterOverride>,
  warnings: string[],
): CodeToDesignLayoutNode {
  const children = node.children.map((child) => applyTextRasterOverrides(child, overrides, warnings));
  if (node.kind !== "text") {
    return {
      ...node,
      children,
    };
  }

  const sourceNodeId = node.sourceNodeIds[0] || null;
  const override = sourceNodeId ? overrides[sourceNodeId] : null;
  if (!override?.dataUrl) {
    return {
      ...node,
      children,
    };
  }

  warnings.push(`rasterized text fallback applied for source node ${sourceNodeId}.`);
  return buildLayoutNode({
    id: node.id,
    kind: "image",
    name: node.name,
    rect: node.rect,
    parentId: node.parentId,
    sourceNodeIds: node.sourceNodeIds,
    children,
    layoutChild: node.layoutChild,
    responsiveRules: node.responsiveRules,
    fillHex: node.fillHex,
    fillOpacity: node.fillOpacity,
    cornerRadius: override.cornerRadius ?? node.cornerRadius,
    absolute: node.absolute,
    unsupportedFeatures: uniqueStrings([...(node.unsupportedFeatures || []), "rasterized_text_fallback"]),
    image: {
      dataUrl: override.dataUrl,
      fitMode: override.fitMode || "stretch",
      cornerRadius: override.cornerRadius ?? node.cornerRadius,
    },
  });
}

function relativeRect(rect: CodeToDesignRect, parentRect: CodeToDesignRect) {
  return {
    x: round(rect.x - parentRect.x),
    y: round(rect.y - parentRect.y),
    width: rect.width,
    height: rect.height,
  };
}

function analysisRefIdForLayoutNode(nodeId: string) {
  return nodeId === "page-root" ? "code-to-design:page-root" : `code-to-design:layout:${nodeId}`;
}

function analysisNodeIdForLayoutNode(nodeId: string) {
  return `analysis:${analysisRefIdForLayoutNode(nodeId)}`;
}

function buildRootFrameCommand(params: {
  frameName: string;
  parentNodeId: string;
  width: number;
  height: number;
}): FigmaCapabilityCommand<"nodes.create-frame"> {
  return {
    type: "capability",
    capabilityId: "nodes.create-frame",
    payload: {
      name: params.frameName,
      width: Math.max(1, Math.round(params.width)),
      height: Math.max(1, Math.round(params.height)),
      parentNodeId: params.parentNodeId,
      analysisRefId: "code-to-design:page-root",
    },
  };
}

function buildConfigureFrameCommand(node: CodeToDesignLayoutNode): FigmaCapabilityCommand<"layout.configure-frame"> | null {
  if (node.kind !== "frame" || !node.layout) {
    return null;
  }
  const layout = node.layout;
  if (
    layout.mode === "NONE" &&
    layout.itemSpacing === undefined &&
    layout.paddingLeft === undefined &&
    layout.paddingRight === undefined &&
    layout.paddingTop === undefined &&
    layout.paddingBottom === undefined &&
    layout.primaryAxisSizingMode === undefined &&
    layout.counterAxisSizingMode === undefined &&
    layout.primaryAxisAlignItems === undefined &&
    layout.counterAxisAlignItems === undefined &&
    layout.clipsContent === undefined &&
    layout.layoutWrap === undefined &&
    layout.counterAxisSpacing === undefined &&
    layout.minWidth === undefined &&
    layout.maxWidth === undefined &&
    layout.minHeight === undefined &&
    layout.maxHeight === undefined
  ) {
    return null;
  }
  return {
    type: "capability",
    capabilityId: "layout.configure-frame",
    payload: {
      layoutMode: layout.mode,
      layoutWrap: layout.layoutWrap,
      primaryAxisSizingMode: layout.primaryAxisSizingMode || "FIXED",
      counterAxisSizingMode: layout.counterAxisSizingMode || "FIXED",
      primaryAxisAlignItems: layout.primaryAxisAlignItems || "MIN",
      counterAxisAlignItems: layout.counterAxisAlignItems || "MIN",
      itemSpacing: layout.itemSpacing,
      counterAxisSpacing: layout.counterAxisSpacing,
      paddingLeft: layout.paddingLeft,
      paddingRight: layout.paddingRight,
      paddingTop: layout.paddingTop,
      paddingBottom: layout.paddingBottom,
      clipsContent: layout.clipsContent,
      minWidth: layout.minWidth,
      maxWidth: layout.maxWidth,
      minHeight: layout.minHeight,
      maxHeight: layout.maxHeight,
    },
    nodeIds: [analysisNodeIdForLayoutNode(node.id)],
  };
}

function buildConfigureChildCommand(node: CodeToDesignLayoutNode): FigmaCapabilityCommand<"layout.configure-child"> | null {
  const layoutPositioning = node.absolute ? "ABSOLUTE" : node.layoutChild?.layoutPositioning;
  if (
    !layoutPositioning &&
    node.layoutChild?.layoutAlign === undefined &&
    node.layoutChild?.layoutGrow === undefined
  ) {
    return null;
  }
  return {
    type: "capability",
    capabilityId: "layout.configure-child",
    payload: {
      layoutAlign: node.layoutChild?.layoutAlign,
      layoutGrow: node.layoutChild?.layoutGrow,
      layoutPositioning,
    },
    nodeIds: [analysisNodeIdForLayoutNode(node.id)],
  };
}

function buildSetAbsoluteChildPositionCommand(
  node: CodeToDesignLayoutNode,
  parentRect: CodeToDesignRect,
): FigmaCapabilityCommand<"geometry.set-position"> | null {
  if (!node.absolute) {
    return null;
  }
  const localRect = relativeRect(node.rect, parentRect);
  return {
    type: "capability",
    capabilityId: "geometry.set-position",
    payload: {
      x: Math.round(localRect.x),
      y: Math.round(localRect.y),
    },
    nodeIds: [analysisNodeIdForLayoutNode(node.id)],
  };
}

function buildReassertFrameSizeCommand(
  node: CodeToDesignLayoutNode,
): FigmaCapabilityCommand<"geometry.set-size"> | null {
  if (node.kind !== "frame" || !node.layout) {
    return null;
  }
  if (node.layout.primaryAxisSizingMode !== "FIXED" || node.layout.counterAxisSizingMode !== "FIXED") {
    return null;
  }
  return {
    type: "capability",
    capabilityId: "geometry.set-size",
    payload: {
      width: Math.max(1, Math.round(node.rect.width)),
      height: Math.max(1, Math.round(node.rect.height)),
    },
    nodeIds: [analysisNodeIdForLayoutNode(node.id)],
  };
}

function buildFrameCreationCommand(
  node: CodeToDesignLayoutNode,
  parentNodeId: string,
  parentRect: CodeToDesignRect,
  parentLayoutMode?: CodeToDesignLayoutMode | null,
): FigmaCapabilityCommand<"nodes.create-frame"> {
  const localRect = relativeRect(node.rect, parentRect);
  const includeLocalPosition = parentLayoutMode === "NONE" || node.absolute;
  return {
    type: "capability",
    capabilityId: "nodes.create-frame",
    payload: {
      name: node.name,
      width: Math.max(1, Math.round(node.rect.width)),
      height: Math.max(1, Math.round(node.rect.height)),
      ...(includeLocalPosition
        ? {
            x: Math.round(localRect.x),
            y: Math.round(localRect.y),
          }
        : {}),
      fillHex: node.fillHex,
      cornerRadius: node.cornerRadius,
      parentNodeId,
      analysisRefId: analysisRefIdForLayoutNode(node.id),
    },
  };
}

function buildTextCommand(
  node: CodeToDesignLayoutNode,
  parentNodeId: string,
  parentRect: CodeToDesignRect,
  parentLayoutMode?: CodeToDesignLayoutMode | null,
) {
  if (node.kind !== "text" || !node.textStyle) {
    return null;
  }
  const localRect = relativeRect(node.rect, parentRect);
  const textAutoResize = node.textStyle.textAutoResize || "NONE";
  const includeLocalPosition = parentLayoutMode === "NONE" || node.absolute;
  return {
    type: "capability" as const,
    capabilityId: "nodes.create-text" as const,
    payload: {
      name: node.name,
      content: node.textContent || "",
      fontFamily: node.textStyle.fontFamily,
      fontFamilyCandidates: node.textStyle.fontFamilyCandidates,
      fontStyle: node.textStyle.fontStyle,
      fontSize: node.textStyle.fontSize,
      fontWeight: node.textStyle.fontWeight,
      colorHex: node.textStyle.colorHex,
      lineHeight: node.textStyle.lineHeight,
      letterSpacing: node.textStyle.letterSpacing,
      alignment: node.textStyle.alignment,
      width:
        textAutoResize === "WIDTH_AND_HEIGHT"
          ? undefined
          : Math.max(1, Math.round(node.rect.width)),
      height:
        textAutoResize === "NONE"
          ? Math.max(1, Math.round(node.rect.height))
          : undefined,
      textAutoResize,
      ...(includeLocalPosition
        ? {
            x: Math.round(localRect.x),
            y: Math.round(localRect.y),
          }
        : {}),
      parentNodeId,
      analysisRefId: analysisRefIdForLayoutNode(node.id),
      resolvedBrowserFontFamily: node.textStyle.resolvedBrowserFontFamily || undefined,
      resolvedBrowserFontStyle: node.textStyle.resolvedBrowserFontStyle || undefined,
    },
  };
}

function buildImageCommand(
  node: CodeToDesignLayoutNode,
  parentNodeId: string,
  parentRect: CodeToDesignRect,
  parentLayoutMode?: CodeToDesignLayoutMode | null,
) {
  if (node.kind !== "image" || !node.image) {
    return null;
  }
  const localRect = relativeRect(node.rect, parentRect);
  const includeLocalPosition = parentLayoutMode === "NONE" || node.absolute;
  return {
    type: "capability" as const,
    capabilityId: "nodes.create-image" as const,
    payload: {
      name: node.name,
      imageDataUrl: node.image.dataUrl,
      width: Math.max(1, Math.round(node.rect.width)),
      height: Math.max(1, Math.round(node.rect.height)),
      ...(includeLocalPosition
        ? {
            x: Math.round(localRect.x),
            y: Math.round(localRect.y),
          }
        : {}),
      fitMode: node.image.fitMode,
      cornerRadius: node.image.cornerRadius,
      parentNodeId,
      analysisRefId: analysisRefIdForLayoutNode(node.id),
    },
  };
}

function buildImageFrameRasterCommands(
  node: CodeToDesignLayoutNode,
  parentNodeId: string,
  parentRect: CodeToDesignRect,
  parentLayoutMode?: CodeToDesignLayoutMode | null,
): FigmaPluginCommandBatch["commands"] | null {
  if (node.kind !== "image" || !node.image) {
    return null;
  }
  const localRect = relativeRect(node.rect, parentRect);
  const analysisRefId = analysisRefIdForLayoutNode(node.id);
  const includeLocalPosition = parentLayoutMode === "NONE" || node.absolute;
  return [
    {
      type: "capability",
      capabilityId: "nodes.create-frame",
      payload: {
        name: `${node.name} Frame`,
        width: Math.max(1, Math.round(node.rect.width)),
        height: Math.max(1, Math.round(node.rect.height)),
        ...(includeLocalPosition
          ? {
              x: Math.round(localRect.x),
              y: Math.round(localRect.y),
            }
          : {}),
        cornerRadius: node.image.cornerRadius,
        parentNodeId,
        analysisRefId,
      },
    },
    {
      type: "capability",
      capabilityId: "nodes.set-clips-content",
      payload: {
        value: true,
      },
      nodeIds: [analysisNodeIdForLayoutNode(node.id)],
    },
    {
      type: "capability",
      capabilityId: "reconstruction.apply-raster-reference",
      payload: {
        referenceDataUrl: node.image.dataUrl,
        resultName: node.name,
        replaceTargetContents: true,
        resizeTargetToReference: false,
        fitMode: node.image.fitMode,
        x: 0,
        y: 0,
        width: Math.max(1, Math.round(node.rect.width)),
        height: Math.max(1, Math.round(node.rect.height)),
      },
      nodeIds: [analysisNodeIdForLayoutNode(node.id)],
    },
  ];
}

function buildLineCommand(
  node: CodeToDesignLayoutNode,
  parentNodeId: string,
  parentRect: CodeToDesignRect,
  parentLayoutMode?: CodeToDesignLayoutMode | null,
) {
  if (node.kind !== "line" || !node.line) {
    return null;
  }
  const localRect = relativeRect(node.rect, parentRect);
  const includeLocalPosition = parentLayoutMode === "NONE" || node.absolute;
  return {
    type: "capability" as const,
    capabilityId: "nodes.create-line" as const,
    payload: {
      name: node.name,
      width: Math.max(1, Math.round(node.rect.width)),
      height: Math.max(1, Math.round(node.rect.height)),
      ...(includeLocalPosition
        ? {
            x: Math.round(localRect.x),
            y: Math.round(localRect.y),
          }
        : {}),
      strokeHex: node.line.strokeHex,
      strokeWeight: node.line.strokeWeight,
      opacity: node.line.opacity,
      rotation: node.line.rotation,
      parentNodeId,
      analysisRefId: analysisRefIdForLayoutNode(node.id),
    },
  };
}

function buildSvgCommand(
  node: CodeToDesignLayoutNode,
  parentNodeId: string,
  parentRect: CodeToDesignRect,
  parentLayoutMode?: CodeToDesignLayoutMode | null,
) {
  if (node.kind !== "svg" || !node.svgMarkup) {
    return null;
  }
  const localRect = relativeRect(node.rect, parentRect);
  const includeLocalPosition = parentLayoutMode === "NONE" || node.absolute;
  return {
    type: "capability" as const,
    capabilityId: "nodes.create-svg" as const,
    payload: {
      name: node.name,
      svgMarkup: node.svgMarkup,
      ...(includeLocalPosition
        ? {
            x: Math.round(localRect.x),
            y: Math.round(localRect.y),
          }
        : {}),
      width: Math.max(1, Math.round(node.rect.width)),
      height: Math.max(1, Math.round(node.rect.height)),
      parentNodeId,
      analysisRefId: analysisRefIdForLayoutNode(node.id),
    },
  };
}

function emitSemanticCommands(params: {
  node: CodeToDesignLayoutNode;
  parentNodeId: string;
  parentRect: CodeToDesignRect;
  parentLayoutMode?: CodeToDesignLayoutMode | null;
  imageStrategy: CodeToDesignImageStrategy;
  commands: FigmaPluginCommandBatch["commands"];
  warnings: string[];
}) {
  const { node, parentNodeId, parentRect, parentLayoutMode, imageStrategy, commands, warnings } = params;

  if (node.kind === "frame") {
    commands.push(buildFrameCreationCommand(node, parentNodeId, parentRect, parentLayoutMode));
    const childParentNodeId = analysisNodeIdForLayoutNode(node.id);
    for (const child of node.children) {
      emitSemanticCommands({
        node: child,
        parentNodeId: childParentNodeId,
        parentRect: node.rect,
        parentLayoutMode: node.layout?.mode || "NONE",
        imageStrategy,
        commands,
        warnings,
      });
    }
    const layoutCommand = buildConfigureFrameCommand(node);
    if (layoutCommand) {
      commands.push(layoutCommand);
    }
    for (const child of node.children) {
      const configureChildCommand = buildConfigureChildCommand(child);
      if (configureChildCommand) {
        commands.push(configureChildCommand);
      }
      const positionChildCommand = buildSetAbsoluteChildPositionCommand(child, node.rect);
      if (positionChildCommand) {
        commands.push(positionChildCommand);
      }
    }
    const reassertFrameSizeCommand = buildReassertFrameSizeCommand(node);
    if (reassertFrameSizeCommand) {
      commands.push(reassertFrameSizeCommand);
    }
    return;
  }

  if (node.kind === "text") {
    const command = buildTextCommand(node, parentNodeId, parentRect, parentLayoutMode);
    if (command) {
      commands.push(command);
    }
    return;
  }

  if (node.kind === "image") {
    if (imageStrategy === "frame_raster") {
      const imageCommands = buildImageFrameRasterCommands(node, parentNodeId, parentRect, parentLayoutMode);
      if (imageCommands) {
        commands.push(...imageCommands);
      } else {
        warnings.push(`image node "${node.name}" 缺少 dataUrl，未能生成图片命令。`);
      }
      return;
    }
    const command = buildImageCommand(node, parentNodeId, parentRect, parentLayoutMode);
    if (command) {
      commands.push(command);
    } else {
      warnings.push(`image node "${node.name}" 缺少 dataUrl，未能生成图片命令。`);
    }
    return;
  }

  if (node.kind === "line") {
    const command = buildLineCommand(node, parentNodeId, parentRect, parentLayoutMode);
    if (command) {
      commands.push(command);
    }
    return;
  }

  if (node.kind === "svg") {
    const command = buildSvgCommand(node, parentNodeId, parentRect, parentLayoutMode);
    if (command) {
      commands.push(command);
    }
  }
}

function buildBorderLine(
  sourceNode: CodeToDesignNodeSnapshot,
  parentId: string,
  edge: "top" | "bottom",
  name: string,
) {
  const width = parseCssPx(edge === "top" ? sourceNode.styles.borderTopWidth : sourceNode.styles.borderBottomWidth, 0);
  const color = parseCssColor(edge === "top" ? sourceNode.styles.borderTopColor : sourceNode.styles.borderBottomColor);
  if (width <= 0 || !color) {
    return null;
  }
  return buildLineNode({
    id: `${parentId}-${edge}-divider`,
    name,
    rect: {
      x: round(sourceNode.rect.x),
      y: edge === "top" ? round(sourceNode.rect.y) : round(sourceNode.rect.y + sourceNode.rect.height - width),
      width: round(sourceNode.rect.width),
      height: Math.max(1, round(width)),
    },
    parentId,
    strokeHex: color.hex,
    strokeWeight: width,
    opacity: color.opacity,
    absolute: true,
  });
}

function buildTextLeafFromSnapshot(
  sourceNode: CodeToDesignNodeSnapshot | null,
  parentId: string,
  name: string,
  options?: {
    layoutChild?: CodeToDesignLayoutNode["layoutChild"];
  },
): CodeToDesignLayoutNode | null {
  if (!sourceNode || !sourceNode.textContent) {
    return null;
  }
  return buildTextNode({
    id: `${parentId}:${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    rect: sourceNode.rect,
    parentId,
    sourceNode,
    layoutChild: options?.layoutChild,
  });
}

function buildImageLeafFromSnapshot(
  sourceNode: CodeToDesignNodeSnapshot | null,
  parentId: string,
  name: string,
  options?: {
    layoutChild?: CodeToDesignLayoutNode["layoutChild"];
  },
): CodeToDesignLayoutNode | null {
  if (!sourceNode) {
    return null;
  }
  return buildImageNode({
    id: `${parentId}:${name.toLowerCase().replace(/\s+/g, "-")}`,
    name,
    rect: sourceNode.rect,
    parentId,
    sourceNode,
    layoutChild: options?.layoutChild,
  });
}

function buildVerticalStackNode(params: {
  id: string;
  name: string;
  parentId: string;
  children: CodeToDesignLayoutNode[];
  rect?: CodeToDesignRect;
  gap?: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  layoutChild?: CodeToDesignLayoutNode["layoutChild"];
  responsiveRules?: CodeToDesignLayoutNode["responsiveRules"];
}) {
  const children = params.children.filter(Boolean);
  const hasExplicitRect = Boolean(params.rect);
  return buildFrameNode({
    id: params.id,
    name: params.name,
    parentId: params.parentId,
    rect: params.rect || unionRects(children.map((child) => child.rect)),
    sourceNodeIds: children.flatMap((child) => child.sourceNodeIds),
    children,
    layout: {
      mode: "VERTICAL",
      itemSpacing: params.gap ?? measureStackGap(children, "y"),
      paddingLeft: params.paddingLeft,
      paddingRight: params.paddingRight,
      paddingTop: params.paddingTop,
      paddingBottom: params.paddingBottom,
      primaryAxisSizingMode: hasExplicitRect ? "FIXED" : "AUTO",
      counterAxisSizingMode: "FIXED",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
    },
    layoutChild: params.layoutChild,
    responsiveRules: params.responsiveRules,
  });
}

function buildHorizontalStackNode(params: {
  id: string;
  name: string;
  parentId: string;
  rect: CodeToDesignRect;
  children: CodeToDesignLayoutNode[];
  gap: number;
  paddingTop?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  paddingRight?: number;
  layoutWrap?: "NO_WRAP" | "WRAP";
  counterAxisSpacing?: number;
  layoutChild?: CodeToDesignLayoutNode["layoutChild"];
  responsiveRules?: CodeToDesignLayoutNode["responsiveRules"];
}) {
  return buildFrameNode({
    id: params.id,
    name: params.name,
    parentId: params.parentId,
    rect: params.rect,
    sourceNodeIds: params.children.flatMap((child) => child.sourceNodeIds),
    children: params.children,
    layout: {
      mode: "HORIZONTAL",
      layoutWrap: params.layoutWrap,
      itemSpacing: params.gap,
      counterAxisSpacing: params.counterAxisSpacing,
      paddingTop: params.paddingTop,
      paddingBottom: params.paddingBottom,
      paddingLeft: params.paddingLeft,
      paddingRight: params.paddingRight,
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
    },
    layoutChild: params.layoutChild,
    responsiveRules: params.responsiveRules,
  });
}

function isEditorialSnapshot(snapshot: CodeToDesignRuntimeSnapshot) {
  return snapshot.nodes.some(
    (node) =>
      hasClass(node, "folio-bar") ||
      hasClass(node, "opening-spread") ||
      hasClass(node, "supporting-grid") ||
      hasClass(node, "look-rail"),
  );
}

function buildMetaStack(index: SnapshotIndex, spreadMetaNode: CodeToDesignNodeSnapshot): CodeToDesignLayoutNode {
  const itemNodes = getChildren(index, spreadMetaNode.id).filter((node) => node.role === "frame" || node.tagName === "DIV");
  const items = itemNodes.map((itemNode, itemIndex) => {
    const labelNode = findTextNodeByClass(index, itemNode.id, "meta-label");
    const valueNode = findTextNodeByClass(index, itemNode.id, "meta-value");
    const labelText = normalizeSemanticName(labelNode?.textContent || "", `Item ${itemIndex + 1}`);
    const children = [
      buildTextLeafFromSnapshot(labelNode, `meta-item-${itemIndex + 1}`, "Meta Label"),
      buildTextLeafFromSnapshot(valueNode, `meta-item-${itemIndex + 1}`, "Meta Value"),
    ].filter(Boolean) as CodeToDesignLayoutNode[];
    return buildVerticalStackNode({
      id: `meta-item-${itemIndex + 1}`,
      name: semanticNameFromLabel("Meta Item", labelText, `Item ${itemIndex + 1}`),
      parentId: "meta-stack",
      rect: itemNode.rect,
      children,
      gap: parseCssPx(itemNode.styles.gap, 5),
    });
  });
  const topDivider = buildBorderLine(spreadMetaNode, "meta-stack", "top", "Meta Divider");
  return buildFrameNode({
    id: "meta-stack",
    name: "Meta Stack",
    parentId: "copy-detail",
    rect: spreadMetaNode.rect,
    sourceNodeIds: [spreadMetaNode.id],
    children: [...items, ...(topDivider ? [topDivider] : [])],
    layout: {
      mode: "VERTICAL",
      itemSpacing: parseCssPx(spreadMetaNode.styles.gap, 16),
      paddingTop: parseCssPx(spreadMetaNode.styles.paddingTop, 18),
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
    },
    layoutChild: {
      layoutAlign: "STRETCH",
    },
  });
}

function buildHeroFigure(
  index: SnapshotIndex,
  figureNode: CodeToDesignNodeSnapshot,
  params: { id: string; name: string; imageName: string; layoutChild?: CodeToDesignLayoutNode["layoutChild"] },
) {
  const imageNode = findFirstImageNode(index, figureNode.id);
  const captionNode = findFirstTextByTag(index, figureNode.id, "FIGCAPTION");
  const children = [
    buildImageLeafFromSnapshot(imageNode, params.id, params.imageName, {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
    buildTextLeafFromSnapshot(captionNode, params.id, "Caption", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
  ].filter(Boolean) as CodeToDesignLayoutNode[];
  const node = buildVerticalStackNode({
    id: params.id,
    name: params.name,
    parentId: "opening-spread",
    rect: figureNode.rect,
    children,
    gap: measureStackGap(children, "y"),
    layoutChild: params.layoutChild || { layoutAlign: "STRETCH" },
  });
  return node;
}

function buildSideNote(index: SnapshotIndex, sideNoteNode: CodeToDesignNodeSnapshot) {
  const labelNode = findTextNodeByClass(index, sideNoteNode.id, "side-note__label");
  const pageNode = findTextNodeByClass(index, sideNoteNode.id, "side-note__page");
  const bodyNode = collectTextNodes(index, sideNoteNode.id).find(
    (node) => node.id !== labelNode?.id && node.id !== pageNode?.id,
  ) || null;
  const bodyChildren = [
    buildTextLeafFromSnapshot(bodyNode, "side-note-copy", "Body Copy", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
    buildTextLeafFromSnapshot(pageNode, "side-note-copy", "Meta Value", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
  ].filter(Boolean) as CodeToDesignLayoutNode[];
  const bodyStack =
    bodyChildren.length > 0
      ? buildVerticalStackNode({
          id: "side-note-copy",
          name: "Side Note Copy",
          parentId: "side-note",
          children: bodyChildren,
          gap: measureStackGap(bodyChildren, "y"),
          layoutChild: { layoutAlign: "STRETCH" },
        })
      : null;
  const topDivider = buildBorderLine(sideNoteNode, "side-note", "top", "Side Note Divider");
  return buildFrameNode({
    id: "side-note",
    name: "Side Note",
    parentId: "side-rail",
    rect: sideNoteNode.rect,
    sourceNodeIds: [sideNoteNode.id],
    children: [
      buildTextLeafFromSnapshot(labelNode, "side-note", "Meta Label", {
        layoutChild: { layoutAlign: "STRETCH" },
      }),
      ...(bodyStack ? [bodyStack] : []),
      ...(topDivider ? [topDivider] : []),
    ].filter(Boolean) as CodeToDesignLayoutNode[],
    layout: {
      mode: "VERTICAL",
      itemSpacing: 12,
      paddingTop: parseCssPx(sideNoteNode.styles.paddingTop, 12),
      primaryAxisSizingMode: "FIXED",
      counterAxisSizingMode: "FIXED",
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "MIN",
    },
    layoutChild: {
      layoutAlign: "STRETCH",
    },
  });
}

function buildOpeningCopy(index: SnapshotIndex, copyNode: CodeToDesignNodeSnapshot) {
  const kickerNode = findTextNodeByClass(index, copyNode.id, "section-kicker");
  const headlineNode = findTextNodeByClass(index, copyNode.id, "spread-headline");
  const subtitleNode = findTextNodeByClass(index, copyNode.id, "spread-subtitle");
  const deckNode = findTextNodeByClass(index, copyNode.id, "spread-deck");
  const spreadMetaNode = findDirectChildByClass(index, copyNode.id, "spread-meta");

  const headlineChildren = [
    buildTextLeafFromSnapshot(kickerNode, "headline-stack", "Kicker", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
    buildTextLeafFromSnapshot(headlineNode, "headline-stack", "Headline", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
  ].filter(Boolean) as CodeToDesignLayoutNode[];
  const headlineRect = resolveChildrenRect(headlineChildren, copyNode.rect);
  const headlineStack = buildVerticalStackNode({
    id: "headline-stack",
    name: "Headline Stack",
    parentId: "opening-copy",
    rect: headlineRect,
    children: headlineChildren,
    gap: measureStackGap(headlineChildren, "y"),
    layoutChild: { layoutAlign: inferWidthLayoutAlign(headlineRect, copyNode.rect) },
  });

  const narrativeChildren = [
    buildTextLeafFromSnapshot(subtitleNode, "narrative-stack", "Subtitle", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
    buildTextLeafFromSnapshot(deckNode, "narrative-stack", "Body Copy", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
  ].filter(Boolean) as CodeToDesignLayoutNode[];
  const narrativeRect = resolveChildrenRect(narrativeChildren, copyNode.rect);
  const narrativeStack = buildVerticalStackNode({
    id: "narrative-stack",
    name: "Narrative Stack",
    parentId: "copy-detail",
    rect: narrativeRect,
    children: narrativeChildren,
    gap: measureStackGap(narrativeChildren, "y"),
    layoutChild: { layoutAlign: inferWidthLayoutAlign(narrativeRect, copyNode.rect) },
  });

  const metaStack = spreadMetaNode ? buildMetaStack(index, spreadMetaNode) : null;
  const copyDetailChildren = [
    narrativeStack,
    ...(metaStack ? [metaStack] : []),
  ];
  const copyDetailRect = resolveChildrenRect(copyDetailChildren, copyNode.rect);
  const copyDetail = buildVerticalStackNode({
    id: "copy-detail",
    name: "Copy Detail",
    parentId: "opening-copy",
    rect: copyDetailRect,
    children: copyDetailChildren,
    gap: measureStackGap(copyDetailChildren, "y"),
    layoutChild: { layoutAlign: inferWidthLayoutAlign(copyDetailRect, copyNode.rect) },
  });

  const children = [headlineStack, copyDetail];
  const node = buildVerticalStackNode({
    id: "opening-copy",
    name: "Opening Copy",
    parentId: "opening-spread",
    rect: copyNode.rect,
    children,
    gap: measureStackGap(children, "y"),
  });
  return node;
}

function buildSupportingIntro(index: SnapshotIndex, introNode: CodeToDesignNodeSnapshot) {
  const kickerNode = findTextNodeByClass(index, introNode.id, "section-kicker");
  const headingNode = findFirstTextByTag(index, introNode.id, "H2");
  const children = [
    buildTextLeafFromSnapshot(kickerNode, "supporting-intro", "Kicker", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
    buildTextLeafFromSnapshot(headingNode, "supporting-intro", "Headline", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
  ].filter(Boolean) as CodeToDesignLayoutNode[];
  const node = buildVerticalStackNode({
    id: "supporting-intro",
    name: "Supporting Intro",
    parentId: "supporting-block",
    rect: introNode.rect,
    children,
    gap: measureStackGap(children, "y"),
    layoutChild: {
      layoutAlign: "STRETCH",
    },
  });
  return node;
}

function buildSupportingCard(
  index: SnapshotIndex,
  cardNode: CodeToDesignNodeSnapshot,
  cardIndex: number,
  layoutChild: CodeToDesignLayoutNode["layoutChild"],
) {
  const labelNode = findFirstNode(index, cardNode.id, (node) => node.role === "text" && node.tagName === "SPAN");
  const bodyNode = findFirstNode(index, cardNode.id, (node) => node.role === "text" && node.tagName === "P");
  const imageNode = findFirstImageNode(index, cardNode.id);
  const copyChildren = [
    buildTextLeafFromSnapshot(labelNode, `supporting-card-copy-${cardIndex + 1}`, "Meta Label", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
    buildTextLeafFromSnapshot(bodyNode, `supporting-card-copy-${cardIndex + 1}`, "Body Copy", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
  ].filter(Boolean) as CodeToDesignLayoutNode[];
  const copyFrame = buildVerticalStackNode({
    id: `supporting-card-copy-${cardIndex + 1}`,
    name: "Supporting Card Copy",
    parentId: `supporting-card-${cardIndex + 1}`,
    children: copyChildren,
    gap: measureStackGap(copyChildren, "y"),
    layoutChild: { layoutAlign: "STRETCH" },
  });
  const title = normalizeSemanticName(labelNode?.textContent || "", `Card ${cardIndex + 1}`);
  const children = [
    buildImageLeafFromSnapshot(
      imageNode,
      `supporting-card-${cardIndex + 1}`,
      `Supporting Card Image ${String(cardIndex + 1).padStart(2, "0")}`,
      {
        layoutChild: { layoutAlign: "STRETCH" },
      },
    ),
    copyFrame,
  ].filter(Boolean) as CodeToDesignLayoutNode[];
  const node = buildVerticalStackNode({
    id: `supporting-card-${cardIndex + 1}`,
    name: semanticNameFromLabel("Supporting Card", title, `Card ${cardIndex + 1}`),
    parentId: "supporting-grid",
    rect: cardNode.rect,
    children,
    gap: measureStackGap(children, "y"),
    layoutChild,
  });
  if (copyFrame.layout) {
    copyFrame.layout.primaryAxisSizingMode = "AUTO";
    copyFrame.layout.counterAxisSizingMode = "FIXED";
  }
  if (node.layout) {
    node.layout.primaryAxisSizingMode = "AUTO";
    node.layout.counterAxisSizingMode = "FIXED";
  }
  return node;
}

function buildLookRailIntro(index: SnapshotIndex, introNode: CodeToDesignNodeSnapshot) {
  const kickerNode = findTextNodeByClass(index, introNode.id, "section-kicker");
  const bodyNode = collectTextNodes(index, introNode.id).find((node) => node.id !== kickerNode?.id) || null;
  const children = [
    buildTextLeafFromSnapshot(kickerNode, "look-rail-intro", "Kicker", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
    buildTextLeafFromSnapshot(bodyNode, "look-rail-intro", "Body Copy", {
      layoutChild: { layoutAlign: "STRETCH" },
    }),
  ].filter(Boolean) as CodeToDesignLayoutNode[];
  const node = buildVerticalStackNode({
    id: "look-rail-intro",
    name: "Look Rail Intro",
    parentId: "look-rail",
    rect: introNode.rect,
    children,
    gap: measureStackGap(children, "y"),
    layoutChild: {
      layoutAlign: "STRETCH",
    },
  });
  return node;
}

function buildLookRailImages(index: SnapshotIndex, imagesNode: CodeToDesignNodeSnapshot) {
  const imageFrames = getChildren(index, imagesNode.id).filter((node) => hasClass(node, "rail-image"));
  const singleColumn = usesSingleColumnLayout(imageFrames) && usesMultipleRows(imageFrames);
  const children = imageFrames
    .map((frameNode, imageIndex) => {
      const imageNode = findFirstImageNode(index, frameNode.id);
      return buildImageLeafFromSnapshot(
        imageNode,
        "look-rail-images",
        `Rail Image ${String(imageIndex + 1).padStart(2, "0")}`,
        {
          layoutChild: singleColumn ? { layoutAlign: "STRETCH" } : { layoutGrow: 1, layoutAlign: "STRETCH" },
        },
      );
    })
    .filter(Boolean) as CodeToDesignLayoutNode[];
  if (singleColumn) {
    return buildVerticalStackNode({
      id: "look-rail-images",
      name: "Look Rail Images",
      parentId: "look-rail",
      rect: imagesNode.rect,
      children,
      gap: parseCssPx(imagesNode.styles.rowGap || imagesNode.styles.gap, 18),
      layoutChild: {
        layoutAlign: "STRETCH",
      },
    });
  }
  return buildHorizontalStackNode({
    id: "look-rail-images",
    name: "Look Rail Images",
    parentId: "look-rail",
    rect: imagesNode.rect,
    children,
    gap: parseCssPx(imagesNode.styles.columnGap || imagesNode.styles.gap, 18),
    layoutWrap: "WRAP",
    counterAxisSpacing: parseCssPx(imagesNode.styles.rowGap || imagesNode.styles.gap, 18),
    layoutChild: {
      layoutGrow: 1,
    },
  });
}

function buildEditorialLayoutTree(snapshot: CodeToDesignRuntimeSnapshot) {
  const warnings: string[] = [];
  const index = buildSnapshotIndex(snapshot);
  const pageNode = findFirstNodeByClass(index, "print-editorial-page");
  const folioBarNode = findFirstNodeByClass(index, "folio-bar");
  const shellNode = findFirstNodeByClass(index, "print-editorial-shell");
  const openingNode = shellNode ? findDirectChildByClass(index, shellNode.id, "opening-spread") : null;
  const supportingNode = shellNode ? findDirectChildByClass(index, shellNode.id, "supporting-block") : null;
  const lookRailNode = shellNode ? findDirectChildByClass(index, shellNode.id, "look-rail") : null;

  if (!folioBarNode || !shellNode || !openingNode || !supportingNode || !lookRailNode) {
    warnings.push("editorial semantic containers are incomplete; planner is falling back to legacy flat export.");
    return { ok: false as const, warnings, layoutTree: buildLegacyLayoutTree(snapshot) };
  }

  const pageWidth = snapshot.page.scrollWidth || snapshot.viewport.width;
  const pageHeight = snapshot.page.scrollHeight || snapshot.viewport.height;
  const rootChildren: CodeToDesignLayoutNode[] = [];

  const gradientSourceNode = pageNode && parseSimpleLinearGradient(pageNode.styles.backgroundImage) ? pageNode : null;
  if (gradientSourceNode) {
    rootChildren.push(
      buildSvgNode({
        id: "page-background",
        name: "Page Background",
        parentId: "page-root",
        rect: {
          x: 0,
          y: 0,
          width: pageWidth,
          height: pageHeight,
        },
        sourceNodeIds: [gradientSourceNode.id],
        svgMarkup: buildGradientSvg({
          width: Math.max(1, Math.round(pageWidth)),
          height: Math.max(1, Math.round(pageHeight)),
          gradient: parseSimpleLinearGradient(gradientSourceNode.styles.backgroundImage)!,
        }),
        absolute: true,
      }),
    );
  } else {
    const pageFill = pageNode ? parseCssColor(pageNode.styles.backgroundColor) : parseCssColor(snapshot.page.backgroundColor);
    if (pageFill) {
      rootChildren.push(
        buildFrameNode({
          id: "page-background",
          name: "Page Background",
          parentId: "page-root",
          rect: { x: 0, y: 0, width: pageWidth, height: pageHeight },
          fillHex: pageFill.hex,
          fillOpacity: pageFill.opacity,
          absolute: true,
        }),
      );
    }
  }

  const folioTexts = getChildren(index, folioBarNode.id).filter((node) => node.role === "text");
  const singleColumnFolio = usesSingleColumnLayout(folioTexts) && usesMultipleRows(folioTexts);
  const folioTextChildren = [
    buildTextLeafFromSnapshot(folioTexts[0] || null, "folio-bar", "Issue Number", {
      layoutChild: singleColumnFolio
        ? { layoutAlign: "STRETCH" }
        : { layoutGrow: 1, layoutAlign: "STRETCH" },
    }),
    buildTextLeafFromSnapshot(folioTexts[1] || null, "folio-bar", "Section Title", {
      layoutChild: singleColumnFolio
        ? { layoutAlign: "STRETCH" }
        : { layoutGrow: 1, layoutAlign: "STRETCH" },
    }),
    buildTextLeafFromSnapshot(folioTexts[2] || null, "folio-bar", "Archive Label", {
      layoutChild: singleColumnFolio
        ? { layoutAlign: "STRETCH" }
        : { layoutGrow: 1, layoutAlign: "STRETCH" },
    }),
    buildBorderLine(folioBarNode, "folio-bar", "bottom", "Folio Divider"),
  ].filter(Boolean) as CodeToDesignLayoutNode[];
  const folioBar = singleColumnFolio
    ? buildVerticalStackNode({
        id: "folio-bar",
        name: "Folio Bar",
        parentId: "page-root",
        rect: folioBarNode.rect,
        gap: parseCssPx(folioBarNode.styles.rowGap || folioBarNode.styles.gap, 12),
        paddingTop: parseCssPx(folioBarNode.styles.paddingTop, 18),
        paddingBottom: parseCssPx(folioBarNode.styles.paddingBottom, 12),
        children: folioTextChildren,
      })
    : buildHorizontalStackNode({
        id: "folio-bar",
        name: "Folio Bar",
        parentId: "page-root",
        rect: folioBarNode.rect,
        gap: parseCssPx(folioBarNode.styles.columnGap || folioBarNode.styles.gap, 12),
        paddingTop: parseCssPx(folioBarNode.styles.paddingTop, 18),
        paddingBottom: parseCssPx(folioBarNode.styles.paddingBottom, 12),
        children: folioTextChildren,
        layoutWrap: "WRAP",
        counterAxisSpacing: parseCssPx(folioBarNode.styles.rowGap || folioBarNode.styles.gap, 12),
      });
  if (folioBar.layout) {
    folioBar.layout.primaryAxisSizingMode = "FIXED";
    folioBar.layout.counterAxisSizingMode = singleColumnFolio ? "FIXED" : "AUTO";
  }
  folioBar.layoutChild = {
    layoutAlign: "STRETCH",
  };

  const openingCopyNode = findDirectChildByClass(index, openingNode.id, "opening-spread__copy");
  const heroFigureNode = findDirectChildByClass(index, openingNode.id, "spread-image--hero");
  const sideRailNode = findDirectChildByClass(index, openingNode.id, "spread-side");
  if (!openingCopyNode || !heroFigureNode || !sideRailNode) {
    warnings.push("opening spread subcontainers are incomplete; planner is falling back to legacy flat export.");
    return { ok: false as const, warnings, layoutTree: buildLegacyLayoutTree(snapshot) };
  }

  const secondaryFigureNode = findDirectChildByClass(index, sideRailNode.id, "spread-image--secondary");
  const sideNoteNode = findDirectChildByClass(index, sideRailNode.id, "side-note");
  const openingSpreadChildren = [
    buildOpeningCopy(index, openingCopyNode),
    buildHeroFigure(index, heroFigureNode, {
      id: "hero-figure",
      name: "Hero Figure",
      imageName: "Hero Image",
    }),
    buildVerticalStackNode({
      id: "side-rail",
      name: "Side Rail",
      parentId: "opening-spread",
      rect: sideRailNode.rect,
      children: [
        ...(secondaryFigureNode
          ? [
              buildHeroFigure(index, secondaryFigureNode, {
                id: "secondary-figure",
                name: "Secondary Figure",
                imageName: "Secondary Image",
                layoutChild: { layoutAlign: "STRETCH" },
              }),
            ]
          : []),
        ...(sideNoteNode ? [buildSideNote(index, sideNoteNode)] : []),
      ],
      gap: parseCssPx(sideRailNode.styles.gap, 18),
    }),
  ];
  const singleColumnOpening = usesSingleColumnLayout([openingCopyNode, heroFigureNode, sideRailNode]) &&
    usesMultipleRows([openingCopyNode, heroFigureNode, sideRailNode]);
  const openingSpread = singleColumnOpening
    ? buildVerticalStackNode({
        id: "opening-spread",
        name: "Opening Spread",
        parentId: "editorial-shell",
        rect: openingNode.rect,
        children: openingSpreadChildren,
        gap: parseCssPx(openingNode.styles.rowGap || openingNode.styles.gap, 24),
        layoutChild: {
          layoutAlign: "STRETCH",
        },
      })
    : buildHorizontalStackNode({
        id: "opening-spread",
        name: "Opening Spread",
        parentId: "editorial-shell",
        rect: openingNode.rect,
        gap: parseCssPx(openingNode.styles.columnGap || openingNode.styles.gap, 24),
        children: openingSpreadChildren,
        layoutWrap: "WRAP",
        counterAxisSpacing: parseCssPx(openingNode.styles.rowGap || openingNode.styles.gap, 24),
        layoutChild: {
          layoutAlign: "STRETCH",
        },
      });
  if (openingSpread.layout) {
    openingSpread.layout.primaryAxisSizingMode = "FIXED";
    openingSpread.layout.counterAxisSizingMode = singleColumnOpening ? "FIXED" : "AUTO";
  }

  const supportingIntroNode = findDirectChildByClass(index, supportingNode.id, "supporting-block__intro");
  const supportingGridNode = findDirectChildByClass(index, supportingNode.id, "supporting-grid");
  if (!supportingIntroNode || !supportingGridNode) {
    warnings.push("supporting block subcontainers are incomplete; planner is falling back to legacy flat export.");
    return { ok: false as const, warnings, layoutTree: buildLegacyLayoutTree(snapshot) };
  }
  const supportingCards = getChildren(index, supportingGridNode.id).filter((node) => hasClass(node, "supporting-card"));
  const singleColumnSupportingGrid = usesSingleColumnLayout(supportingCards) && usesMultipleRows(supportingCards);
  const supportingGridChildren = supportingCards.map((cardNode, cardIndex) =>
    buildSupportingCard(
      index,
      cardNode,
      cardIndex,
      singleColumnSupportingGrid ? { layoutAlign: "STRETCH" } : { layoutGrow: 1, layoutAlign: "STRETCH" },
    ),
  );
  const supportingGrid = singleColumnSupportingGrid
    ? buildVerticalStackNode({
        id: "supporting-grid",
        name: "Supporting Grid",
        parentId: "supporting-block",
        rect: supportingGridNode.rect,
        children: supportingGridChildren,
        gap: parseCssPx(supportingGridNode.styles.rowGap || supportingGridNode.styles.gap, 18),
        layoutChild: {
          layoutAlign: "STRETCH",
        },
      })
    : buildHorizontalStackNode({
        id: "supporting-grid",
        name: "Supporting Grid",
        parentId: "supporting-block",
        rect: supportingGridNode.rect,
        gap: parseCssPx(supportingGridNode.styles.columnGap || supportingGridNode.styles.gap, 18),
        children: supportingGridChildren,
        layoutWrap: "WRAP",
        counterAxisSpacing: parseCssPx(supportingGridNode.styles.rowGap || supportingGridNode.styles.gap, 18),
        layoutChild: {
          layoutGrow: 1,
        },
      });
  if (supportingGrid.layout) {
    supportingGrid.layout.primaryAxisSizingMode = "FIXED";
    supportingGrid.layout.counterAxisSizingMode = singleColumnSupportingGrid ? "FIXED" : "AUTO";
  }
  const supportingDivider = buildBorderLine(supportingNode, "supporting-block", "top", "Supporting Divider");
  const singleColumnSupportingBlock = usesSingleColumnLayout([supportingIntroNode, supportingGridNode]) &&
    usesMultipleRows([supportingIntroNode, supportingGridNode]);
  const supportingBlockChildren = [
    buildSupportingIntro(index, supportingIntroNode),
    supportingGrid,
    ...(supportingDivider ? [supportingDivider] : []),
  ];
  const supportingBlock = singleColumnSupportingBlock
    ? buildVerticalStackNode({
        id: "supporting-block",
        name: "Supporting Block",
        parentId: "editorial-shell",
        rect: supportingNode.rect,
        gap: parseCssPx(supportingNode.styles.rowGap || supportingNode.styles.gap, 22),
        paddingTop: parseCssPx(supportingNode.styles.paddingTop, 18),
        children: supportingBlockChildren,
        layoutChild: {
          layoutAlign: "STRETCH",
        },
      })
    : buildHorizontalStackNode({
        id: "supporting-block",
        name: "Supporting Block",
        parentId: "editorial-shell",
        rect: supportingNode.rect,
        gap: parseCssPx(supportingNode.styles.columnGap || supportingNode.styles.gap, 22),
        paddingTop: parseCssPx(supportingNode.styles.paddingTop, 18),
        children: supportingBlockChildren,
        layoutWrap: "WRAP",
        counterAxisSpacing: parseCssPx(supportingNode.styles.rowGap || supportingNode.styles.gap, 22),
        layoutChild: {
          layoutAlign: "STRETCH",
        },
      });
  if (supportingBlock.layout) {
    supportingBlock.layout.primaryAxisSizingMode = "FIXED";
    supportingBlock.layout.counterAxisSizingMode = singleColumnSupportingBlock ? "FIXED" : "AUTO";
  }

  const lookRailIntroNode = findDirectChildByClass(index, lookRailNode.id, "look-rail__intro");
  const lookRailImagesNode = findDirectChildByClass(index, lookRailNode.id, "look-rail__images");
  if (!lookRailIntroNode || !lookRailImagesNode) {
    warnings.push("look rail subcontainers are incomplete; planner is falling back to legacy flat export.");
    return { ok: false as const, warnings, layoutTree: buildLegacyLayoutTree(snapshot) };
  }
  const lookRailDivider = buildBorderLine(lookRailNode, "look-rail", "top", "Look Rail Divider");
  const singleColumnLookRail = usesSingleColumnLayout([lookRailIntroNode, lookRailImagesNode]) &&
    usesMultipleRows([lookRailIntroNode, lookRailImagesNode]);
  const lookRailChildren = [
    buildLookRailIntro(index, lookRailIntroNode),
    buildLookRailImages(index, lookRailImagesNode),
    ...(lookRailDivider ? [lookRailDivider] : []),
  ];
  const lookRail = singleColumnLookRail
    ? buildVerticalStackNode({
        id: "look-rail",
        name: "Look Rail",
        parentId: "editorial-shell",
        rect: lookRailNode.rect,
        gap: parseCssPx(lookRailNode.styles.rowGap || lookRailNode.styles.gap, 22),
        paddingTop: parseCssPx(lookRailNode.styles.paddingTop, 18),
        children: lookRailChildren,
        layoutChild: {
          layoutAlign: "STRETCH",
        },
      })
    : buildHorizontalStackNode({
        id: "look-rail",
        name: "Look Rail",
        parentId: "editorial-shell",
        rect: lookRailNode.rect,
        gap: parseCssPx(lookRailNode.styles.columnGap || lookRailNode.styles.gap, 22),
        paddingTop: parseCssPx(lookRailNode.styles.paddingTop, 18),
        children: lookRailChildren,
        layoutWrap: "WRAP",
        counterAxisSpacing: parseCssPx(lookRailNode.styles.rowGap || lookRailNode.styles.gap, 22),
        layoutChild: {
          layoutAlign: "STRETCH",
        },
      });
  if (lookRail.layout) {
    lookRail.layout.primaryAxisSizingMode = "FIXED";
    lookRail.layout.counterAxisSizingMode = singleColumnLookRail ? "FIXED" : "AUTO";
  }

  const editorialShellChildren = [openingSpread, supportingBlock, lookRail];
  const editorialShell = buildVerticalStackNode({
    id: "editorial-shell",
    name: "Editorial Shell",
    parentId: "page-root",
    rect: shellNode.rect,
    children: editorialShellChildren,
    gap: measureStackGap(editorialShellChildren, "y"),
    paddingTop: parseCssPx(shellNode.styles.paddingTop, 26),
    paddingBottom: parseCssPx(shellNode.styles.paddingBottom, 54),
  });
  if (editorialShell.layout) {
    editorialShell.layout.primaryAxisSizingMode = "AUTO";
    editorialShell.layout.counterAxisSizingMode = "FIXED";
  }
  editorialShell.layoutChild = {
    layoutAlign: "STRETCH",
  };

  rootChildren.push(folioBar, editorialShell);
  return {
    ok: true as const,
    warnings,
    layoutTree: buildFrameNode({
      id: "page-root",
      name: snapshot.page.title || "Code To Design Page",
      parentId: null,
      rect: { x: 0, y: 0, width: pageWidth, height: pageHeight },
      children: rootChildren,
      sourceNodeIds: [
        ...(pageNode ? [pageNode.id] : []),
        folioBarNode.id,
        shellNode.id,
      ],
      layout: {
        mode: "VERTICAL",
        itemSpacing: 0,
        paddingLeft: round(folioBarNode.rect.x),
        paddingRight: round(pageWidth - (folioBarNode.rect.x + folioBarNode.rect.width)),
        primaryAxisSizingMode: "FIXED",
        counterAxisSizingMode: "FIXED",
        primaryAxisAlignItems: "MIN",
        counterAxisAlignItems: "MIN",
      },
    }),
  };
}

function buildLegacyLayoutTree(snapshot: CodeToDesignRuntimeSnapshot): CodeToDesignLayoutNode {
  const renderableNodes = snapshot.nodes.filter((node) =>
    node.visible &&
    node.rect.width > 0 &&
    node.rect.height > 0 &&
    node.parentId !== null &&
    (node.role === "text" || node.role === "image" || node.role === "shape"),
  );
  const backgroundChildren: CodeToDesignLayoutNode[] = [];
  const pageWidth = snapshot.page.scrollWidth || snapshot.viewport.width;
  const pageHeight = snapshot.page.scrollHeight || snapshot.viewport.height;
  const pageGradient = parseSimpleLinearGradient(snapshot.page.backgroundImage);
  if (pageGradient) {
    backgroundChildren.push(
      buildSvgNode({
        id: "page-background",
        name: "Page Background",
        parentId: "page-root",
        rect: { x: 0, y: 0, width: pageWidth, height: pageHeight },
        svgMarkup: buildGradientSvg({
          width: Math.max(1, Math.round(pageWidth)),
          height: Math.max(1, Math.round(pageHeight)),
          gradient: pageGradient,
        }),
      }),
    );
  } else {
    const pageFill = parseCssColor(snapshot.page.backgroundColor);
    if (pageFill) {
      backgroundChildren.push(
        buildFrameNode({
          id: "page-background",
          name: "Page Background",
          parentId: "page-root",
          rect: { x: 0, y: 0, width: pageWidth, height: pageHeight },
          fillHex: pageFill.hex,
          fillOpacity: pageFill.opacity,
        }),
      );
    }
  }
  return buildFrameNode({
    id: "page-root",
    name: snapshot.page.title || "Code To Design Page",
    parentId: null,
    rect: {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    },
    children: [...backgroundChildren, ...renderableNodes.flatMap((node) => {
      if (node.role === "text") {
        return [buildTextNode({
          id: node.id,
          name: DOM_TAG_NAME_PATTERN.test(node.name) ? normalizeSemanticName(node.textContent || "", "Text") : node.name,
          rect: node.rect,
          parentId: "page-root",
          sourceNode: node,
        })];
      }
      if (node.role === "image" && node.image?.dataUrl) {
        return [buildImageNode({
          id: node.id,
          name: DOM_TAG_NAME_PATTERN.test(node.name) ? "Image" : node.name,
          rect: node.rect,
          parentId: "page-root",
          sourceNode: node,
        })!];
      }
      if (node.role === "shape") {
        const fill = parseCssColor(node.styles.backgroundColor);
        const gradient = parseSimpleLinearGradient(node.styles.backgroundImage);
        if (gradient) {
          return [buildSvgNode({
            id: node.id,
            name: DOM_TAG_NAME_PATTERN.test(node.name) ? "Background Shape" : node.name,
            rect: node.rect,
            parentId: "page-root",
            svgMarkup: buildGradientSvg({
              width: Math.max(1, Math.round(node.rect.width)),
              height: Math.max(1, Math.round(node.rect.height)),
              gradient,
            }),
            sourceNodeIds: [node.id],
          })];
        }
        if (fill) {
          return [buildFrameNode({
            id: node.id,
            name: DOM_TAG_NAME_PATTERN.test(node.name) ? "Background Shape" : node.name,
            parentId: "page-root",
            rect: node.rect,
            fillHex: fill.hex,
            fillOpacity: fill.opacity,
            cornerRadius: Math.max(
              parseCssPx(node.styles.borderTopLeftRadius, 0),
              parseCssPx(node.styles.borderTopRightRadius, 0),
              parseCssPx(node.styles.borderBottomLeftRadius, 0),
              parseCssPx(node.styles.borderBottomRightRadius, 0),
            ),
            sourceNodeIds: [node.id],
          })];
        }
      }
      return [];
    })],
  });
}

function summarizePlanCommands(commands: FigmaPluginCommandBatch["commands"]) {
  return {
    commandCount: commands.length,
    frameCommandCount: commands.filter((command) => command.type === "capability" && command.capabilityId === "nodes.create-frame").length,
    layoutCommandCount: commands.filter((command) =>
      command.type === "capability" &&
      (
        command.capabilityId === "layout.configure-frame" ||
        command.capabilityId === "layout.configure-child" ||
        command.capabilityId === "geometry.set-position" ||
        command.capabilityId === "geometry.set-size"
      )
    ).length,
    textCommandCount: commands.filter((command) => command.type === "capability" && command.capabilityId === "nodes.create-text").length,
    imageCommandCount: commands.filter((command) =>
      command.type === "capability" &&
      (command.capabilityId === "nodes.create-image" || command.capabilityId === "reconstruction.apply-raster-reference")
    ).length,
    shapeCommandCount: commands.filter((command) =>
      command.type === "capability" &&
      (command.capabilityId === "nodes.create-rectangle" ||
        command.capabilityId === "nodes.create-svg" ||
        command.capabilityId === "nodes.create-line")
    ).length,
  };
}

export function buildCodeToDesignPlan(params: {
  snapshot: CodeToDesignRuntimeSnapshot;
  frameName?: string;
  parentNodeId: string;
  imageStrategy?: CodeToDesignImageStrategy;
  textRasterOverrides?: Record<string, CodeToDesignTextRasterOverride>;
}): CodeToDesignPlan {
  const warnings: string[] = [...params.snapshot.warnings];
  const textRasterOverrides = params.textRasterOverrides || {};
  const hasTextRasterOverrides = Object.keys(textRasterOverrides).length > 0;
  if (hasTextRasterOverrides) {
    throw new Error(
      `textRasterOverrides are disabled. Non-image content must remain editable; refusing raster overrides for: ${Object.keys(textRasterOverrides).join(", ")}`,
    );
  }
  const imageStrategy = params.imageStrategy || "node";
  const editorialResult = isEditorialSnapshot(params.snapshot)
    ? buildEditorialLayoutTree(params.snapshot)
    : { ok: false as const, warnings: ["editorial class metadata missing; planner used legacy flat export."], layoutTree: buildLegacyLayoutTree(params.snapshot) };
  warnings.push(...editorialResult.warnings);

  const layoutTree = editorialResult.layoutTree;
  attachResponsiveRules(params.snapshot, layoutTree);
  const commands: FigmaPluginCommandBatch["commands"] = [];
  const rootNode = {
    ...layoutTree,
    name: params.frameName || layoutTree.name,
  } satisfies CodeToDesignLayoutNode;
  emitSemanticCommands({
    node: rootNode,
    parentNodeId: params.parentNodeId,
    parentRect: layoutTree.rect,
    parentLayoutMode: null,
    imageStrategy,
    commands,
    warnings,
  });

  const qualityReport = buildCodeToDesignQualityReport({
    snapshot: params.snapshot,
    layoutTree,
    requiredContainerNames: isEditorialSnapshot(params.snapshot) ? EDITORIAL_REQUIRED_CONTAINERS : ["Page"],
    phase: "preflight",
  });

  return {
    batch: {
      source: "codex",
      commands,
    },
    summary: summarizePlanCommands(commands),
    warnings: uniqueStrings(warnings),
    layoutTree,
    qualityReport,
  };
}

export function formatCodeToDesignPlan(plan: CodeToDesignPlan) {
  return [
    "Code-to-Design Plan",
    `commands: ${plan.summary.commandCount}`,
    `frames: ${plan.summary.frameCommandCount}`,
    `layout: ${plan.summary.layoutCommandCount}`,
    `text: ${plan.summary.textCommandCount}`,
    `images: ${plan.summary.imageCommandCount}`,
    `shapes: ${plan.summary.shapeCommandCount}`,
    `quality: ${plan.qualityReport.overallStatus}`,
    `structure: ${plan.qualityReport.structure.score}`,
    `naming: ${plan.qualityReport.naming.score}`,
    `fonts: ${plan.qualityReport.fontAlignment.status}`,
    ...(plan.warnings.length
      ? ["warnings:", ...plan.warnings.map((warning) => `- ${escapeXml(warning)}`)]
      : []),
  ].join("\n");
}
