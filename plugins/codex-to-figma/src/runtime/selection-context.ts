import type { PluginNodeSummary } from "../../../../shared/plugin-bridge.js";

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

export function getBoundFillVariableIds(node: any) {
  const fills = "boundVariables" in node ? node.boundVariables && node.boundVariables.fills : null;
  if (!Array.isArray(fills)) {
    return [];
  }

  return fills
    .map((entry: any) =>
      entry && typeof entry.id === "string" ? entry.id : null,
    )
    .filter((value: string | null): value is string => Boolean(value));
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

export function nodeSummary(node: any): PluginNodeSummary {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    fillable: supportsFills(node),
    fills: nodeFillSummary(node),
    fillStyleId: supportsFills(node) ? node.fillStyleId || null : null,
  };
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

async function exportImageFillPreviewDataUrl(node: any) {
  if (!supportsFills(node) || node.fills === figma.mixed) {
    return null;
  }

  const imagePaint = node.fills.find(
    (paint: any) => paint && paint.type === "IMAGE" && typeof paint.imageHash === "string",
  );
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
