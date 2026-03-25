import type {
  PluginImageArtifact,
  PluginNodeInspection,
  PluginNodeSummary,
  PluginNodeStyleBindings,
  PluginNodeVariableBindings,
} from "../../../../shared/plugin-bridge.js";

const FILL_CAPABLE_TYPES = new Set([
  "BOOLEAN_OPERATION",
  "COMPONENT",
  "COMPONENT_SET",
  "ELLIPSE",
  "FRAME",
  "INSTANCE",
  "LINE",
  "POLYGON",
  "RECTANGLE",
  "SECTION",
  "SHAPE_WITH_TEXT",
  "STAR",
  "TEXT",
  "VECTOR",
]);

const STROKE_CAPABLE_TYPES = new Set([
  "BOOLEAN_OPERATION",
  "COMPONENT",
  "COMPONENT_SET",
  "ELLIPSE",
  "FRAME",
  "INSTANCE",
  "LINE",
  "POLYGON",
  "RECTANGLE",
  "SECTION",
  "SHAPE_WITH_TEXT",
  "STAR",
  "TEXT",
  "VECTOR",
]);

const RADIUS_CAPABLE_TYPES = new Set([
  "COMPONENT",
  "COMPONENT_SET",
  "FRAME",
  "INSTANCE",
  "RECTANGLE",
]);

const ANALYSIS_REF_SHARED_NAMESPACE = "autodesign";
const ANALYSIS_REF_SHARED_KEY = "analysisRef";

export function normalizeHex(input: string) {
  const value = String(input || "").trim().replace(/^#/, "");
  if (!/^[\da-fA-F]{3}$|^[\da-fA-F]{6}$/.test(value)) {
    throw new Error("颜色必须是 3 位或 6 位十六进制值，例如 #FF6FAE。");
  }

  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;

  return `#${expanded.toUpperCase()}`;
}

export function hexToRgb(hex: string) {
  const normalized = normalizeHex(hex).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16) / 255,
    g: Number.parseInt(normalized.slice(2, 4), 16) / 255,
    b: Number.parseInt(normalized.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex(color: { r: number; g: number; b: number }) {
  const toHex = (channel: number) => {
    const value = Math.max(0, Math.min(255, Math.round(channel * 255)));
    return value.toString(16).padStart(2, "0").toUpperCase();
  };

  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

export function createSolidPaint(hex: string) {
  return {
    type: "SOLID",
    color: hexToRgb(hex),
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
  };
}

export function supportsFills(node: any) {
  return FILL_CAPABLE_TYPES.has(node.type);
}

export function supportsStrokes(node: any) {
  return STROKE_CAPABLE_TYPES.has(node.type);
}

export function supportsCornerRadius(node: any) {
  return RADIUS_CAPABLE_TYPES.has(node.type);
}

export function getSelection() {
  const selection = figma.currentPage.selection;
  if (!selection.length) {
    throw new Error("请先在 Figma 里选中至少一个节点。");
  }
  return selection;
}

export function clonePaints(paints: any[]) {
  return paints.map((paint) => Object.assign({}, paint));
}

function uniqueSortedStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

export function getBoundFillVariableIds(node: any) {
  const fills = "boundVariables" in node ? node.boundVariables && node.boundVariables.fills : null;
  if (!Array.isArray(fills)) {
    return [];
  }

  return uniqueSortedStrings(
    fills
    .map((entry: any) =>
      entry && typeof entry.id === "string" ? entry.id : null,
    )
    .filter((value: string | null): value is string => Boolean(value)),
  );
}

function readStyleId(node: any, key: string) {
  return typeof node?.[key] === "string" && node[key] ? node[key] : null;
}

function readStyleBindings(node: any): PluginNodeStyleBindings {
  return {
    fillStyleId: supportsFills(node) ? readStyleId(node, "fillStyleId") : null,
    strokeStyleId: supportsStrokes(node) ? readStyleId(node, "strokeStyleId") : null,
    textStyleId: readStyleId(node, "textStyleId"),
    effectStyleId: readStyleId(node, "effectStyleId"),
    gridStyleId: readStyleId(node, "gridStyleId"),
  };
}

function collectVariableIdsFromBindingValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectVariableIdsFromBindingValue(entry));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const directId = typeof record.id === "string" ? [record.id] : [];
  return [
    ...directId,
    ...Object.entries(record)
      .filter(([key]) => key !== "id")
      .flatMap(([, entry]) => collectVariableIdsFromBindingValue(entry)),
  ];
}

function readVariableBindings(node: any): PluginNodeVariableBindings {
  if (!node || !("boundVariables" in node) || !node.boundVariables || typeof node.boundVariables !== "object") {
    return {};
  }

  const entries = Object.entries(node.boundVariables as Record<string, unknown>)
    .map(([key, value]) => [key, uniqueSortedStrings(collectVariableIdsFromBindingValue(value))] as const)
    .filter(([, ids]) => ids.length > 0)
    .sort((left, right) => left[0].localeCompare(right[0]));

  return Object.fromEntries(entries);
}

function readBoundVariableIds(variableBindings: PluginNodeVariableBindings) {
  return uniqueSortedStrings(Object.values(variableBindings).flat());
}

export function nodeFillSummary(node: any) {
  if (!supportsFills(node)) {
    return [];
  }

  if (node.fills === figma.mixed) {
    return ["mixed"];
  }

  return node.fills.map((paint: any) => {
    if (paint.type !== "SOLID") {
      return paint.type.toLowerCase();
    }

    return rgbToHex(paint.color);
  });
}

function getAbsolutePosition(node: any) {
  if ("absoluteTransform" in node && Array.isArray(node.absoluteTransform)) {
    const transform = node.absoluteTransform;
    if (
      Array.isArray(transform[0]) &&
      Array.isArray(transform[1]) &&
      typeof transform[0][2] === "number" &&
      typeof transform[1][2] === "number"
    ) {
      return {
        x: transform[0][2],
        y: transform[1][2],
      };
    }
  }

  if ("x" in node && "y" in node && typeof node.x === "number" && typeof node.y === "number") {
    return {
      x: node.x,
      y: node.y,
    };
  }

  return null;
}

function getParentNode(node: any) {
  return node && "parent" in node ? node.parent : null;
}

function readLayoutMode(node: any) {
  return node && "layoutMode" in node && typeof node.layoutMode === "string"
    ? node.layoutMode
    : null;
}

function readLayoutPositioning(node: any) {
  return node && "layoutPositioning" in node && typeof node.layoutPositioning === "string"
    ? node.layoutPositioning
    : null;
}

export function nodeSummary(node: any): PluginNodeSummary {
  const parent = getParentNode(node);
  const absolutePosition = getAbsolutePosition(node);
  const styleBindings = readStyleBindings(node);
  const variableBindings = readVariableBindings(node);
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    fillable: supportsFills(node),
    fills: nodeFillSummary(node),
    fillStyleId: styleBindings.fillStyleId,
    styleBindings,
    boundVariableIds: readBoundVariableIds(variableBindings),
    variableBindings,
    x: typeof node.x === "number" ? node.x : null,
    y: typeof node.y === "number" ? node.y : null,
    absoluteX: absolutePosition ? absolutePosition.x : null,
    absoluteY: absolutePosition ? absolutePosition.y : null,
    width: typeof node.width === "number" ? node.width : null,
    height: typeof node.height === "number" ? node.height : null,
    parentNodeId: parent?.id || null,
    parentNodeType: parent?.type || null,
    parentLayoutMode: readLayoutMode(parent),
    layoutMode: readLayoutMode(node),
    layoutPositioning: readLayoutPositioning(node),
    hasImageFill: Boolean(findImagePaint(node)),
  };
}

function readOpacity(node: any) {
  return typeof node?.opacity === "number" ? node.opacity : null;
}

function readRotation(node: any) {
  return typeof node?.rotation === "number" ? node.rotation : null;
}

function strokeSummary(node: any) {
  if (!supportsStrokes(node)) {
    return [];
  }
  if (node.strokes === figma.mixed) {
    return ["mixed"];
  }
  return Array.isArray(node.strokes)
    ? node.strokes.map((paint: any) => {
        if (!paint || paint.type !== "SOLID") {
          return paint?.type ? String(paint.type).toLowerCase() : "unknown";
        }
        return rgbToHex(paint.color);
      })
    : [];
}

function readCornerRadius(node: any) {
  return supportsCornerRadius(node) && typeof node.cornerRadius === "number"
    ? node.cornerRadius
    : null;
}

function readBooleanProperty(node: any, key: string) {
  return typeof node?.[key] === "boolean" ? node[key] : null;
}

function readNumericProperty(node: any, key: string) {
  return typeof node?.[key] === "number" ? node[key] : null;
}

function readStringProperty(node: any, key: string) {
  return typeof node?.[key] === "string" ? node[key] : null;
}

function readConstraints(node: any) {
  if (!node || !node.constraints || typeof node.constraints !== "object") {
    return {
      horizontal: null,
      vertical: null,
    };
  }
  return {
    horizontal: typeof node.constraints.horizontal === "string" ? node.constraints.horizontal : null,
    vertical: typeof node.constraints.vertical === "string" ? node.constraints.vertical : null,
  };
}

function readMainComponentInfo(node: any) {
  if (!node || !("mainComponent" in node) || !node.mainComponent) {
    return {
      id: null,
      name: null,
    };
  }
  return {
    id: typeof node.mainComponent.id === "string" ? node.mainComponent.id : null,
    name: typeof node.mainComponent.name === "string" ? node.mainComponent.name : null,
  };
}

function readKeyList(record: unknown) {
  if (!record || typeof record !== "object") {
    return [];
  }
  return Object.keys(record as Record<string, unknown>).sort();
}

function readVariantProperties(node: any) {
  if (!node || !node.variantProperties || typeof node.variantProperties !== "object") {
    return undefined;
  }
  const entries = Object.entries(node.variantProperties as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string",
  );
  if (!entries.length) {
    return undefined;
  }
  return Object.fromEntries(entries.sort((left, right) => left[0].localeCompare(right[0])));
}

function readTextContent(node: any) {
  return typeof node?.characters === "string" ? node.characters : null;
}

function readFontInfo(node: any) {
  if (!node || !("fontName" in node) || node.fontName === figma.mixed || !node.fontName) {
    return {
      family: null,
      style: null,
      weight: null,
    };
  }
  const family = typeof node.fontName.family === "string" ? node.fontName.family : null;
  const style = typeof node.fontName.style === "string" ? node.fontName.style : null;
  let weight: number | string | null = null;
  if (style) {
    const normalized = style.toLowerCase();
    if (normalized.includes("extra bold")) weight = 800;
    else if (normalized.includes("bold")) weight = 700;
    else if (normalized.includes("semi")) weight = 600;
    else if (normalized.includes("medium")) weight = 500;
    else if (normalized.includes("light")) weight = 300;
    else weight = style;
  }
  return { family, style, weight };
}

function readTextMetric(node: any, key: "fontSize" | "lineHeight" | "letterSpacing") {
  if (!node || !(key in node)) {
    return null;
  }
  const value = node[key];
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object" && typeof value.value === "number") {
    return value.value;
  }
  return null;
}

function readAnalysisRefId(node: any) {
  if (!node || typeof node.getSharedPluginData !== "function") {
    return null;
  }
  const value = node.getSharedPluginData(
    ANALYSIS_REF_SHARED_NAMESPACE,
    ANALYSIS_REF_SHARED_KEY,
  );
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isReconstructionGeneratedNode(node: any) {
  const name = typeof node?.name === "string" ? node.name : "";
  return (
    name.startsWith("AD Vector/") ||
    name.startsWith("AD Hybrid/") ||
    name.startsWith("AD Rebuild/")
  );
}

export function inspectNodeSubtree(root: any, options?: { maxDepth?: number }) {
  const maxDepth = Number.isFinite(options?.maxDepth) ? Math.max(0, Math.floor(options!.maxDepth!)) : 6;
  const inspected: PluginNodeInspection[] = [];

  const visit = (node: any, depth: number) => {
    const parent = getParentNode(node);
    const siblings =
      parent && "children" in parent && Array.isArray(parent.children) ? parent.children : null;
    const indexWithinParent =
      siblings && typeof siblings.findIndex === "function"
        ? siblings.findIndex((candidate: any) => candidate?.id === node.id)
        : -1;
    const fontInfo = readFontInfo(node);
    const constraints = readConstraints(node);
    const mainComponent = readMainComponentInfo(node);
    const summary = nodeSummary(node);
    inspected.push({
      ...summary,
      depth,
      childCount:
        "children" in node && Array.isArray(node.children) ? node.children.length : 0,
      indexWithinParent: indexWithinParent >= 0 ? indexWithinParent : 0,
      analysisRefId: readAnalysisRefId(node),
      visible: typeof node?.visible === "boolean" ? node.visible : null,
      locked: typeof node?.locked === "boolean" ? node.locked : null,
      opacity: readOpacity(node),
      rotation: readRotation(node),
      strokes: strokeSummary(node),
      strokeStyleId: summary.styleBindings?.strokeStyleId ?? null,
      cornerRadius: readCornerRadius(node),
      clipsContent: readBooleanProperty(node, "clipsContent"),
      isMask: readBooleanProperty(node, "isMask"),
      maskType: readStringProperty(node, "maskType"),
      constraintsHorizontal: constraints.horizontal,
      constraintsVertical: constraints.vertical,
      layoutGrow: readNumericProperty(node, "layoutGrow"),
      layoutAlign: readStringProperty(node, "layoutAlign"),
      layoutSizingHorizontal: readStringProperty(node, "layoutSizingHorizontal"),
      layoutSizingVertical: readStringProperty(node, "layoutSizingVertical"),
      primaryAxisSizingMode: readStringProperty(node, "primaryAxisSizingMode"),
      counterAxisSizingMode: readStringProperty(node, "counterAxisSizingMode"),
      primaryAxisAlignItems: readStringProperty(node, "primaryAxisAlignItems"),
      counterAxisAlignItems: readStringProperty(node, "counterAxisAlignItems"),
      itemSpacing: readNumericProperty(node, "itemSpacing"),
      paddingLeft: readNumericProperty(node, "paddingLeft"),
      paddingRight: readNumericProperty(node, "paddingRight"),
      paddingTop: readNumericProperty(node, "paddingTop"),
      paddingBottom: readNumericProperty(node, "paddingBottom"),
      textContent: readTextContent(node),
      fontFamily: fontInfo.family,
      fontStyle: fontInfo.style,
      fontWeight: fontInfo.weight,
      fontSize: readTextMetric(node, "fontSize"),
      lineHeight: readTextMetric(node, "lineHeight"),
      letterSpacing: readTextMetric(node, "letterSpacing"),
      textAlignment:
        typeof node?.textAlignHorizontal === "string" ? node.textAlignHorizontal : null,
      mainComponentId: mainComponent.id,
      mainComponentName: mainComponent.name,
      componentPropertyReferences: readKeyList(node?.componentPropertyReferences),
      componentPropertyDefinitionKeys: readKeyList(node?.componentPropertyDefinitions),
      variantProperties: readVariantProperties(node),
      generatedBy: isReconstructionGeneratedNode(node) ? "reconstruction" : null,
    });

    if (depth >= maxDepth || !("children" in node) || !Array.isArray(node.children)) {
      return;
    }
    for (const child of node.children) {
      visit(child, depth + 1);
    }
  };

  visit(root, 0);
  return inspected;
}

function bytesToBase64(bytes: Uint8Array) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const chunk = (first << 16) | (second << 8) | third;

    output += alphabet[(chunk >> 18) & 63];
    output += alphabet[(chunk >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(chunk >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[chunk & 63] : "=";
  }

  return output;
}

function parsePngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24) {
    return null;
  }
  return {
    width:
      ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0,
    height:
      ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0,
  };
}

function parseGifDimensions(bytes: Uint8Array) {
  if (bytes.length < 10) {
    return null;
  }
  return {
    width: bytes[6] | (bytes[7] << 8),
    height: bytes[8] | (bytes[9] << 8),
  };
}

function parseJpegDimensions(bytes: Uint8Array) {
  let index = 2;
  while (index + 8 < bytes.length) {
    if (bytes[index] !== 0xff) {
      index += 1;
      continue;
    }

    const marker = bytes[index + 1];
    index += 2;
    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }
    if (index + 1 >= bytes.length) {
      break;
    }

    const segmentLength = (bytes[index] << 8) | bytes[index + 1];
    if (segmentLength < 2 || index + segmentLength > bytes.length) {
      break;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: (bytes[index + 3] << 8) | bytes[index + 4],
        width: (bytes[index + 5] << 8) | bytes[index + 6],
      };
    }

    index += segmentLength;
  }

  return null;
}

function detectImageMime(bytes: Uint8Array) {
  if (bytes.length >= 8) {
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (pngSignature.every((value, index) => bytes[index] === value)) {
      return "image/png";
    }
  }

  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return "image/jpeg";
  }

  if (bytes.length >= 6) {
    const header = String.fromCharCode(...bytes.slice(0, 6));
    if (header === "GIF87a" || header === "GIF89a") {
      return "image/gif";
    }
  }

  return "application/octet-stream";
}

function detectImageDimensions(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/png") {
    return parsePngDimensions(bytes);
  }
  if (mimeType === "image/gif") {
    return parseGifDimensions(bytes);
  }
  if (mimeType === "image/jpeg") {
    return parseJpegDimensions(bytes);
  }
  return null;
}

function findImagePaint(node: any) {
  if (!supportsFills(node) || node.fills === figma.mixed) {
    return null;
  }

  return node.fills.find(
    (paint: any) => paint && paint.type === "IMAGE" && typeof paint.imageHash === "string",
  ) || null;
}

async function exportImageFillPreviewDataUrl(node: any) {
  const imagePaint = findImagePaint(node);
  if (!imagePaint) {
    return null;
  }

  const image = figma.getImageByHash(imagePaint.imageHash);
  if (!image) {
    return null;
  }

  try {
    const bytes = await image.getBytesAsync();
    const mimeType = detectImageMime(bytes);
    return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
  } catch {
    return null;
  }
}

export async function exportNodeImageArtifact(
  node: any,
  options?: {
    preferOriginalBytes?: boolean;
    constraint?: { type: "WIDTH" | "HEIGHT" | "SCALE"; value: number };
  },
): Promise<PluginImageArtifact | null> {
  const imagePaint = options?.preferOriginalBytes ? findImagePaint(node) : null;
  if (imagePaint) {
    const image = figma.getImageByHash(imagePaint.imageHash);
    if (image) {
      try {
        const bytes = await image.getBytesAsync();
        const mimeType = detectImageMime(bytes);
        const dimensions =
          detectImageDimensions(bytes, mimeType) || {
            width: typeof node.width === "number" ? Math.round(node.width) : 0,
            height: typeof node.height === "number" ? Math.round(node.height) : 0,
          };
        return {
          kind: "node-image",
          nodeId: node.id,
          mimeType,
          width: dimensions.width,
          height: dimensions.height,
          dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
          source: "image-fill-original",
        };
      } catch {
        // Fall back to node export below.
      }
    }
  }

  if (!("exportAsync" in node) || typeof node.exportAsync !== "function") {
    return null;
  }

  try {
    const exportConstraint =
      options?.constraint &&
      Number.isFinite(options.constraint.value) &&
      options.constraint.value > 0
        ? {
            type: options.constraint.type,
            value: options.constraint.value,
          }
        : undefined;
    const bytes = await node.exportAsync({
      format: "PNG",
      ...(exportConstraint ? { constraint: exportConstraint } : {}),
    });
    const mimeType = "image/png";
    const dimensions =
      detectImageDimensions(bytes, mimeType) || {
        width: typeof node.width === "number" ? Math.round(node.width) : 0,
        height: typeof node.height === "number" ? Math.round(node.height) : 0,
      };
    return {
      kind: "node-image",
      nodeId: node.id,
      mimeType,
      width: dimensions.width,
      height: dimensions.height,
      dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
      source: "node-export",
    };
  } catch {
    return null;
  }
}

async function exportNodePreviewDataUrl(node: any) {
  if (!("exportAsync" in node) || typeof node.exportAsync !== "function") {
    return null;
  }

  try {
    const imageFillPreview = await exportImageFillPreviewDataUrl(node);
    if (imageFillPreview) {
      return imageFillPreview;
    }

    const bytes = await node.exportAsync({
      format: "PNG",
      constraint: {
        type: "WIDTH",
        value: 160,
      },
    });
    return `data:image/png;base64,${bytesToBase64(bytes)}`;
  } catch {
    return null;
  }
}

export async function currentSelectionUiPayload() {
  const nodes = [...figma.currentPage.selection];

  return Promise.all(
    nodes.map(async (node) => ({
      ...nodeSummary(node),
      previewDataUrl: await exportNodePreviewDataUrl(node),
    })),
  );
}
