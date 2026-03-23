import {
  IMPLEMENTED_PLUGIN_CAPABILITIES,
  getPluginCapabilityDescriptor,
  type PluginCapabilityDescriptor,
  type PluginCapabilityId,
} from "../../../../shared/plugin-capabilities.js";
import type {
  PluginCommandExecutionResult,
  PluginRuntimeFeatures,
} from "../../../../shared/plugin-bridge.js";
import type {
  FigmaCapabilityCommand,
  FigmaPluginCommand,
  FigmaPluginCommandBatch,
} from "../../../../shared/plugin-contract.js";
import { requiresExplicitNodeIdsForExternalCapability } from "../../../../shared/plugin-targeting.js";
import {
  clonePaints,
  createSolidPaint,
  exportNodeImageArtifact,
  getBoundFillVariableIds,
  getSelection,
  inspectNodeSubtree,
  normalizeHex,
  supportsCornerRadius,
  supportsFills,
  supportsStrokes,
} from "./selection-context.js";

// ── Undo stack ──────────────────────────────────────────────────────────

type PropertySnapshot = { nodeId: string; properties: Record<string, any> };
type UndoEntry = {
  capabilityId: PluginCapabilityId;
  snapshots: PropertySnapshot[];
  createdNodeIds: string[];
};

const UNDO_STACK_MAX = 20;
const undoStack: UndoEntry[] = [];

const NON_UNDOABLE_CAPABILITIES = new Set<string>([
  "selection.refresh",
  "undo.undo-last",
  "nodes.delete",
  "assets.export-node-image",
  "reconstruction.apply-raster-reference",
  "styles.upsert-paint-style",
  "styles.upsert-text-style",
  "variables.upsert-color-variable",
]);

const CREATION_CAPABILITIES = new Set<string>([
  "nodes.create-frame",
  "nodes.create-text",
  "nodes.create-rectangle",
  "nodes.create-ellipse",
  "nodes.create-line",
  "nodes.create-svg",
  "components.create-instance",
  "nodes.duplicate",
  "nodes.group",
  "nodes.frame-selection",
]);

function snapshotNodeProperties(
  node: any,
  capabilityId: PluginCapabilityId,
): Record<string, any> | null {
  const props: Record<string, any> = {};

  switch (capabilityId) {
    case "fills.set-fill":
    case "fills.clear-fill":
    case "text.set-text-color":
      if ("fills" in node) props.fills = clonePaints(node.fills === figma.mixed ? [] : node.fills);
      if ("fillStyleId" in node) props.fillStyleId = node.fillStyleId;
      break;
    case "strokes.set-stroke":
    case "strokes.clear-stroke":
      if ("strokes" in node) props.strokes = clonePaints(node.strokes === figma.mixed ? [] : node.strokes);
      if ("strokeStyleId" in node) props.strokeStyleId = node.strokeStyleId;
      break;
    case "strokes.set-weight":
      if ("strokeWeight" in node) props.strokeWeight = node.strokeWeight;
      break;
    case "effects.set-shadow":
    case "effects.set-layer-blur":
    case "effects.clear-effects":
      if ("effects" in node) props.effects = node.effects.map((e: any) => ({ ...e }));
      break;
    case "geometry.set-radius":
      if ("cornerRadius" in node) props.cornerRadius = node.cornerRadius;
      break;
    case "geometry.set-size":
      if ("width" in node) { props.width = node.width; props.height = node.height; }
      break;
    case "geometry.set-position":
      if ("x" in node) { props.x = node.x; props.y = node.y; }
      break;
    case "nodes.set-opacity":
      if ("opacity" in node) props.opacity = node.opacity;
      break;
    case "layout.configure-frame":
      if ("layoutMode" in node) props.layoutMode = node.layoutMode;
      if ("primaryAxisSizingMode" in node) props.primaryAxisSizingMode = node.primaryAxisSizingMode;
      if ("counterAxisSizingMode" in node) props.counterAxisSizingMode = node.counterAxisSizingMode;
      if ("primaryAxisAlignItems" in node) props.primaryAxisAlignItems = node.primaryAxisAlignItems;
      if ("counterAxisAlignItems" in node) props.counterAxisAlignItems = node.counterAxisAlignItems;
      if ("itemSpacing" in node) props.itemSpacing = node.itemSpacing;
      if ("paddingLeft" in node) props.paddingLeft = node.paddingLeft;
      if ("paddingRight" in node) props.paddingRight = node.paddingRight;
      if ("paddingTop" in node) props.paddingTop = node.paddingTop;
      if ("paddingBottom" in node) props.paddingBottom = node.paddingBottom;
      if ("clipsContent" in node) props.clipsContent = node.clipsContent;
      break;
    case "layout.configure-child":
      if ("layoutAlign" in node) props.layoutAlign = node.layoutAlign;
      if ("layoutGrow" in node) props.layoutGrow = node.layoutGrow;
      if ("layoutPositioning" in node) props.layoutPositioning = node.layoutPositioning;
      break;
    case "nodes.rename":
      if ("name" in node) props.name = node.name;
      break;
    case "nodes.set-clips-content":
      if ("clipsContent" in node) props.clipsContent = node.clipsContent;
      break;
    case "nodes.set-mask":
      if ("isMask" in node) props.isMask = node.isMask;
      break;
    case "text.set-content":
      if ("characters" in node) props.characters = node.characters;
      break;
    case "text.set-font-size":
      if ("fontSize" in node) props.fontSize = node.fontSize;
      break;
    case "text.set-font-family":
    case "text.set-font-weight":
      if ("fontName" in node) props.fontName = node.fontName !== figma.mixed ? { ...node.fontName } : null;
      break;
    case "text.set-line-height":
      if ("lineHeight" in node) props.lineHeight = node.lineHeight;
      break;
    case "text.set-letter-spacing":
      if ("letterSpacing" in node) props.letterSpacing = node.letterSpacing;
      break;
    case "text.set-alignment":
      if ("textAlignHorizontal" in node) props.textAlignHorizontal = node.textAlignHorizontal;
      break;
    case "styles.apply-style":
      if ("fillStyleId" in node) props.fillStyleId = node.fillStyleId;
      if ("textStyleId" in node) props.textStyleId = node.textStyleId;
      break;
    case "styles.detach-style":
      if ("fillStyleId" in node) props.fillStyleId = node.fillStyleId;
      if ("strokeStyleId" in node) props.strokeStyleId = node.strokeStyleId;
      if ("textStyleId" in node) props.textStyleId = node.textStyleId;
      break;
    default:
      return null;
  }

  return Object.keys(props).length > 0 ? props : null;
}

// ── End undo helpers ────────────────────────────────────────────────────

type BatchRunResult = {
  ok: boolean;
  results: PluginCommandExecutionResult[];
  message: string;
};

function successResult(
  capabilityId: PluginCapabilityId,
  message: string,
  details?: Partial<Omit<PluginCommandExecutionResult, "capabilityId" | "ok" | "message">>,
): PluginCommandExecutionResult {
  return {
    capabilityId,
    ok: true,
    changedNodeIds: [],
    createdStyleIds: [],
    createdVariableIds: [],
    exportedImages: [],
    inspectedNodes: [],
    warnings: [],
    errorCode: null,
    message,
    ...(details || {}),
  };
}

function failureResult(
  capabilityId: PluginCapabilityId,
  message: string,
  details?: Partial<Omit<PluginCommandExecutionResult, "capabilityId" | "ok" | "message">>,
): PluginCommandExecutionResult {
  return {
    capabilityId,
    ok: false,
    changedNodeIds: [],
    createdStyleIds: [],
    createdVariableIds: [],
    exportedImages: [],
    inspectedNodes: [],
    warnings: [],
    errorCode: "capability_failed",
    message,
    ...(details || {}),
  };
}

function decodeDataUrl(dataUrl: string) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("图片 dataUrl 格式无效。");
  }

  const base64 = match[2];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const normalized = base64.replace(/=+$/, "");
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value < 0) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 255);
    }
  }

  const bytes = new Uint8Array(output);
  return {
    mimeType: match[1],
    bytes,
  };
}

function normalizeLegacyCommand(command: FigmaPluginCommand): FigmaCapabilityCommand {
  if (command.type === "capability") {
    return command;
  }

  switch (command.type) {
    case "refresh-selection":
      return {
        type: "capability",
        capabilityId: "selection.refresh",
        payload: {},
      };
    case "set-selection-fill":
      return {
        type: "capability",
        capabilityId: "fills.set-fill",
        payload: { hex: command.hex },
      };
    case "set-selection-stroke":
      return {
        type: "capability",
        capabilityId: "strokes.set-stroke",
        payload: { hex: command.hex },
      };
    case "set-selection-radius":
      return {
        type: "capability",
        capabilityId: "geometry.set-radius",
        payload: { value: command.value },
      };
    case "set-selection-opacity":
      return {
        type: "capability",
        capabilityId: "nodes.set-opacity",
        payload: { value: command.value },
      };
    case "create-or-update-paint-style":
      return {
        type: "capability",
        capabilityId: "styles.upsert-paint-style",
        payload: {
          name: command.name,
          hex: command.hex,
          applyToSelection: command.applyToSelection,
        },
      };
    case "create-or-update-color-variable":
      return {
        type: "capability",
        capabilityId: "variables.upsert-color-variable",
        payload: {
          collectionName: command.collectionName,
          variableName: command.variableName,
          hex: command.hex,
          bindToSelection: command.bindToSelection,
        },
      };
    default:
      return command satisfies never;
  }
}

function applyFillToNode(node: any, paint: any) {
  if (!supportsFills(node)) {
    return false;
  }

  node.fills = [paint];
  try { node.fillStyleId = ""; } catch { /* no style binding to clear */ }
  return true;
}

function clearFillOnNode(node: any) {
  if (!supportsFills(node)) {
    return false;
  }

  node.fills = [];
  try { node.fillStyleId = ""; } catch { /* no style binding to clear */ }
  return true;
}

function applyStrokeToNode(node: any, paint: any) {
  if (!supportsStrokes(node)) {
    return false;
  }

  node.strokes = [paint];
  try { node.strokeStyleId = ""; } catch { /* no style binding to clear */ }
  if (!node.strokeWeight || node.strokeWeight <= 0) {
    node.strokeWeight = 1;
  }
  return true;
}

function clearStrokeOnNode(node: any) {
  if (!supportsStrokes(node)) {
    return false;
  }

  node.strokes = [];
  try { node.strokeStyleId = ""; } catch { /* no style binding to clear */ }
  return true;
}

function applyStrokeWeightToNode(node: any, value: number) {
  if (!supportsStrokes(node)) {
    return {
      changed: false,
      warning: null,
    };
  }

  if (node.strokes !== figma.mixed && Array.isArray(node.strokes) && node.strokes.length === 0) {
    return {
      changed: false,
      warning: `${node.name || node.id} 当前没有 stroke，已跳过描边粗细修改。`,
    };
  }

  node.strokeWeight = value;
  return {
    changed: true,
    warning: null,
  };
}

function supportsEffects(node: any) {
  return "effects" in node;
}

function supportsResize(node: any) {
  return "resize" in node && typeof node.resize === "function";
}

function supportsPosition(node: any) {
  return "x" in node && "y" in node;
}

function createShadowEffect(payload: {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread?: number;
  colorHex?: string;
  opacity?: number;
}) {
  const basePaint = createSolidPaint(payload.colorHex || "#000000");
  return {
    type: "DROP_SHADOW",
    color: {
      ...basePaint.color,
      a: Math.max(0, Math.min(1, (payload.opacity ?? 20) / 100)),
    },
    offset: {
      x: payload.offsetX,
      y: payload.offsetY,
    },
    radius: payload.blur,
    spread: payload.spread ?? 0,
    visible: true,
    blendMode: "NORMAL",
  };
}

function setShadowOnNode(
  node: any,
  payload: {
    offsetX: number;
    offsetY: number;
    blur: number;
    spread?: number;
    colorHex?: string;
    opacity?: number;
  },
) {
  if (!supportsEffects(node)) {
    return false;
  }

  const currentEffects = Array.isArray(node.effects)
    ? node.effects.map((effect: any) => Object.assign({}, effect))
    : [];
  const preservedEffects = currentEffects.filter((effect: any) => effect.type !== "DROP_SHADOW");
  node.effects = [...preservedEffects, createShadowEffect(payload)];
  return true;
}

function setLayerBlurOnNode(node: any, radius: number) {
  if (!supportsEffects(node)) {
    return false;
  }

  const currentEffects = Array.isArray(node.effects)
    ? node.effects.map((effect: any) => Object.assign({}, effect))
    : [];
  const preservedEffects = currentEffects.filter((effect: any) => effect.type !== "LAYER_BLUR");
  node.effects = [
    ...preservedEffects,
    {
      type: "LAYER_BLUR",
      radius,
      visible: true,
    },
  ];
  return true;
}

function clearEffectsOnNode(node: any) {
  if (!supportsEffects(node)) {
    return false;
  }

  node.effects = [];
  return true;
}

function resizeNode(node: any, width: number, height: number) {
  if (!supportsResize(node)) {
    return false;
  }

  node.resize(width, height);
  return true;
}

function moveNode(node: any, x: number, y: number) {
  if (!supportsPosition(node)) {
    return false;
  }

  node.x = x;
  node.y = y;
  return true;
}

function supportsNaming(node: any) {
  return "name" in node;
}

function supportsCloning(node: any) {
  return "clone" in node && typeof node.clone === "function";
}

function supportsChildren(node: any) {
  return node && "children" in node && Array.isArray(node.children);
}

function supportsClipsContent(node: any) {
  return node && "clipsContent" in node;
}

function supportsMasking(node: any) {
  return node && "isMask" in node;
}

async function resolveParentNode(parentNodeId?: string): Promise<any> {
  if (!parentNodeId) {
    return figma.currentPage;
  }

  const node = await figma.getNodeByIdAsync(parentNodeId);
  if (!node) {
    throw new Error(`parentNodeId "${parentNodeId}" 在当前文件中未找到。`);
  }

  if (!supportsChildren(node)) {
    throw new Error(
      `parentNodeId "${parentNodeId}" (${node.type}) 不是容器节点，不支持子节点。`,
    );
  }

  return node;
}

async function resolveComponentNode(componentNodeId: string): Promise<any> {
  const node = await figma.getNodeByIdAsync(componentNodeId);
  if (!node) {
    throw new Error(`mainComponentNodeId "${componentNodeId}" 在当前文件中未找到。`);
  }
  if (node.type !== "COMPONENT") {
    throw new Error(`mainComponentNodeId "${componentNodeId}" 不是 COMPONENT，当前为 ${node.type}。`);
  }
  return node;
}

function configureFrameLayout(
  node: any,
  payload: {
    layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
    primaryAxisSizingMode?: "FIXED" | "AUTO";
    counterAxisSizingMode?: "FIXED" | "AUTO";
    primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
    counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
    itemSpacing?: number;
    paddingLeft?: number;
    paddingRight?: number;
    paddingTop?: number;
    paddingBottom?: number;
    clipsContent?: boolean;
  },
) {
  if (!node || !("layoutMode" in node)) {
    throw new Error(`${node?.name || node?.id || "目标节点"} 不支持 Auto Layout。`);
  }

  if (payload.layoutMode) {
    node.layoutMode = payload.layoutMode;
  }
  if (payload.primaryAxisSizingMode) {
    node.primaryAxisSizingMode = payload.primaryAxisSizingMode;
  }
  if (payload.counterAxisSizingMode) {
    node.counterAxisSizingMode = payload.counterAxisSizingMode;
  }
  if (payload.primaryAxisAlignItems) {
    node.primaryAxisAlignItems = payload.primaryAxisAlignItems;
  }
  if (payload.counterAxisAlignItems) {
    node.counterAxisAlignItems = payload.counterAxisAlignItems;
  }
  if (payload.itemSpacing !== undefined) {
    if (!Number.isFinite(payload.itemSpacing)) {
      throw new Error("itemSpacing 必须是有效数字。");
    }
    node.itemSpacing = Number(payload.itemSpacing);
  }
  for (const key of ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom"] as const) {
    const value = payload[key];
    if (value === undefined) {
      continue;
    }
    if (!Number.isFinite(value) || Number(value) < 0) {
      throw new Error(`${key} 必须是大于等于 0 的数字。`);
    }
    node[key] = Number(value);
  }
  if (payload.clipsContent !== undefined && supportsClipsContent(node)) {
    node.clipsContent = Boolean(payload.clipsContent);
  }
}

function configureChildLayout(
  node: any,
  payload: {
    layoutAlign?: "INHERIT" | "STRETCH" | "MIN" | "CENTER" | "MAX";
    layoutGrow?: number;
    layoutPositioning?: "AUTO" | "ABSOLUTE";
  },
) {
  if (payload.layoutAlign && "layoutAlign" in node) {
    node.layoutAlign = payload.layoutAlign;
  }
  if (payload.layoutGrow !== undefined && "layoutGrow" in node) {
    if (!Number.isFinite(payload.layoutGrow) || Number(payload.layoutGrow) < 0) {
      throw new Error("layoutGrow 必须是大于等于 0 的数字。");
    }
    node.layoutGrow = Number(payload.layoutGrow);
  }
  if (payload.layoutPositioning && "layoutPositioning" in node) {
    node.layoutPositioning = payload.layoutPositioning;
  }
}

function renameNode(node: any, name: string) {
  if (!supportsNaming(node)) {
    return false;
  }

  node.name = name;
  return true;
}

function duplicateNode(node: any, offsetX: number, offsetY: number) {
  if (!supportsCloning(node)) {
    return null;
  }

  const cloned = node.clone();
  if (supportsPosition(node) && supportsPosition(cloned)) {
    cloned.x = node.x + offsetX;
    cloned.y = node.y + offsetY;
  }
  return cloned;
}

function applyFillStrokeOpacity(
  node: any,
  options: {
    fillHex?: string;
    strokeHex?: string;
    strokeWeight?: number;
    opacity?: number;
  },
) {
  if (options.fillHex && "fills" in node) {
    node.fills = [createSolidPaint(options.fillHex)];
  } else if ("fills" in node && node.type !== "LINE") {
    node.fills = [];
  }

  if (options.strokeHex && "strokes" in node) {
    node.strokes = [createSolidPaint(options.strokeHex)];
  } else if ("strokes" in node && node.type === "LINE") {
    node.strokes = [];
  }

  if (options.strokeWeight !== undefined && "strokeWeight" in node) {
    if (!Number.isFinite(options.strokeWeight) || Number(options.strokeWeight) < 0) {
      throw new Error("strokeWeight 必须是大于等于 0 的数字。");
    }
    node.strokeWeight = Number(options.strokeWeight);
  }

  if (options.opacity !== undefined && "opacity" in node) {
    if (!Number.isFinite(options.opacity) || Number(options.opacity) < 0 || Number(options.opacity) > 1) {
      throw new Error("opacity 必须是 0 到 1 之间的数字。");
    }
    node.opacity = Number(options.opacity);
  }
}

function getCommonParent(nodes: any[]) {
  if (!nodes.length) {
    throw new Error("当前没有可处理的节点。");
  }

  const parent = nodes[0].parent;
  if (!parent || !supportsChildren(parent)) {
    throw new Error("当前 selection 缺少可写父级，无法执行该操作。");
  }

  for (const node of nodes) {
    if (node.parent !== parent) {
      throw new Error("当前 selection 的节点不在同一个父级下，无法执行该操作。");
    }
  }

  return parent;
}

function getInsertionIndex(parent: any, nodes: any[]) {
  const indexes = nodes
    .map((node) => parent.children.indexOf(node))
    .filter((index: number) => index >= 0);
  return indexes.length ? Math.min(...indexes) : parent.children.length;
}

function getNodeBounds(node: any) {
  if (
    !supportsPosition(node) ||
    typeof node.width !== "number" ||
    typeof node.height !== "number"
  ) {
    throw new Error(`${node.name || node.id} 缺少可计算边界的几何信息。`);
  }

  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
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

  if (supportsPosition(node)) {
    return {
      x: node.x,
      y: node.y,
    };
  }

  throw new Error(`${node.name || node.id} 缺少可计算绝对位置的几何信息。`);
}

function getAbsoluteNodeBounds(node: any) {
  const absolute = getAbsolutePosition(node);
  if (typeof node.width !== "number" || typeof node.height !== "number") {
    throw new Error(`${node.name || node.id} 缺少可计算绝对边界的尺寸信息。`);
  }

  return {
    x: absolute.x,
    y: absolute.y,
    width: node.width,
    height: node.height,
  };
}

function getSceneRoot(node: any) {
  let current = node;
  while (current && "parent" in current && current.parent) {
    current = current.parent;
  }
  return current;
}

function getParentAbsoluteOrigin(parent: any) {
  if (!parent || parent.type === "PAGE") {
    return {
      x: 0,
      y: 0,
    };
  }

  return getAbsolutePosition(parent);
}

function toLocalPosition(parent: any, absolutePosition: { x: number; y: number }) {
  const origin = getParentAbsoluteOrigin(parent);
  return {
    x: absolutePosition.x - origin.x,
    y: absolutePosition.y - origin.y,
  };
}

function parentUsesAutoLayout(parent: any) {
  return "layoutMode" in parent && typeof parent.layoutMode === "string" && parent.layoutMode !== "NONE";
}

function hasExplicitCreationParent(command: FigmaCapabilityCommand) {
  if (!CREATION_CAPABILITIES.has(command.capabilityId)) {
    return false;
  }
  const payload =
    command.payload && typeof command.payload === "object"
      ? (command.payload as { parentNodeId?: unknown })
      : null;
  return typeof payload?.parentNodeId === "string" && payload.parentNodeId.trim().length > 0;
}

async function resolveAnchorNodeForCreation(command: FigmaCapabilityCommand) {
  if (!command.nodeIds || command.nodeIds.length === 0) {
    throw new Error(
      `外部修改命令必须指定 nodeIds。capability=${command.capabilityId}。创建节点时请使用 nodeIds 指定锚点节点。`,
    );
  }

  if (command.nodeIds.length !== 1) {
    throw new Error(`创建节点时只支持一个锚点 nodeId，当前收到 ${command.nodeIds.length} 个。`);
  }

  const anchorNode = await figma.getNodeByIdAsync(command.nodeIds[0]);
  if (!anchorNode) {
    throw new Error(`锚点 nodeId "${command.nodeIds[0]}" 未找到。`);
  }

  return anchorNode;
}

function computeRelativePlacement(
  anchorNode: any,
  size: { width: number; height: number },
  placement: "above" | "below" | "left" | "right",
  gap: number,
) {
  const anchorBounds = getAbsoluteNodeBounds(anchorNode);

  switch (placement) {
    case "below":
      return {
        x: anchorBounds.x + (anchorBounds.width - size.width) / 2,
        y: anchorBounds.y + anchorBounds.height + gap,
      };
    case "above":
      return {
        x: anchorBounds.x + (anchorBounds.width - size.width) / 2,
        y: anchorBounds.y - gap - size.height,
      };
    case "left":
      return {
        x: anchorBounds.x - gap - size.width,
        y: anchorBounds.y + (anchorBounds.height - size.height) / 2,
      };
    case "right":
      return {
        x: anchorBounds.x + anchorBounds.width + gap,
        y: anchorBounds.y + (anchorBounds.height - size.height) / 2,
      };
    default:
      return {
        x: anchorBounds.x,
        y: anchorBounds.y,
      };
  }
}

function computeRasterPlacement(
  targetWidth: number,
  targetHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  fitMode: "cover" | "contain" | "stretch",
) {
  if (fitMode === "stretch") {
    return {
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(targetWidth)),
      height: Math.max(1, Math.round(targetHeight)),
      scaleMode: "FILL" as const,
    };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;
  const useContain =
    fitMode === "contain"
      ? sourceAspect > targetAspect
      : sourceAspect < targetAspect;

  const width = useContain ? targetWidth : targetHeight * sourceAspect;
  const height = useContain ? targetWidth / sourceAspect : targetHeight;

  return {
    x: Math.round((targetWidth - width) / 2),
    y: Math.round((targetHeight - height) / 2),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    scaleMode: "FILL" as const,
  };
}

function groupNodes(nodes: any[], name?: string) {
  if (nodes.length < 2) {
    throw new Error("分组至少需要 2 个节点。");
  }

  const parent = getCommonParent(nodes);
  const group = figma.group(nodes, parent, getInsertionIndex(parent, nodes));
  if (name && name.trim()) {
    group.name = name.trim();
  }

  return group;
}

function frameNodes(nodes: any[], options?: { name?: string; padding?: number }) {
  if (nodes.length < 2) {
    throw new Error("包裹 Frame 至少需要 2 个节点。");
  }

  const parent = getCommonParent(nodes);
  const padding = Math.max(0, Number(options?.padding ?? 0));
  const insertionIndex = getInsertionIndex(parent, nodes);
  const frame = figma.createFrame();
  parent.insertChild(insertionIndex, frame);

  const bounds = nodes.map((node) => ({
    node,
    box: getNodeBounds(node),
  }));
  const minX = Math.min(...bounds.map((entry) => entry.box.x));
  const minY = Math.min(...bounds.map((entry) => entry.box.y));
  const maxX = Math.max(...bounds.map((entry) => entry.box.x + entry.box.width));
  const maxY = Math.max(...bounds.map((entry) => entry.box.y + entry.box.height));

  frame.x = minX - padding;
  frame.y = minY - padding;
  frame.resize(maxX - minX + padding * 2, maxY - minY + padding * 2);

  for (const entry of bounds) {
    frame.appendChild(entry.node);
    entry.node.x = entry.box.x - frame.x;
    entry.node.y = entry.box.y - frame.y;
  }

  if (options?.name && options.name.trim()) {
    frame.name = options.name.trim();
  }

  return frame;
}

function supportsText(node: any) {
  return node.type === "TEXT" && "characters" in node;
}

function getPrimaryFontName(node: any) {
  if (!supportsText(node)) {
    return null;
  }

  if (node.fontName && node.fontName !== figma.mixed) {
    return node.fontName;
  }

  if (typeof node.getRangeAllFontNames === "function" && typeof node.characters === "string") {
    const fonts = node.getRangeAllFontNames(0, node.characters.length);
    if (Array.isArray(fonts) && fonts.length > 0) {
      return fonts[0];
    }
  }

  return null;
}

async function loadNodeFonts(node: any) {
  if (!supportsText(node)) {
    return;
  }

  const fontsToLoad: any[] = [];
  if (node.fontName && node.fontName !== figma.mixed) {
    fontsToLoad.push(node.fontName);
  } else if (typeof node.getRangeAllFontNames === "function" && typeof node.characters === "string") {
    fontsToLoad.push(...node.getRangeAllFontNames(0, node.characters.length));
  }

  const seen = new Set<string>();
  for (const font of fontsToLoad) {
    if (!font || font === figma.mixed) {
      continue;
    }

    const key = `${font.family}::${font.style}`;
    if (seen.has(key)) {
      continue;
    }

    await figma.loadFontAsync(font);
    seen.add(key);
  }
}

function normalizeFontWeightStyle(value: number | string) {
  if (typeof value === "number") {
    if (value >= 800) {
      return "Extra Bold";
    }
    if (value >= 700) {
      return "Bold";
    }
    if (value >= 600) {
      return "Semi Bold";
    }
    if (value >= 500) {
      return "Medium";
    }
    if (value >= 300) {
      return "Regular";
    }
    return "Light";
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    throw new Error("字重不能为空。");
  }
  if (normalized.includes("semi") || normalized.includes("semibold") || normalized.includes("半粗")) {
    return "Semi Bold";
  }
  if (normalized.includes("bold") || normalized.includes("粗体")) {
    return "Bold";
  }
  if (normalized.includes("medium") || normalized.includes("中字")) {
    return "Medium";
  }
  if (normalized.includes("light") || normalized.includes("细体")) {
    return "Light";
  }
  if (normalized.includes("regular") || normalized.includes("normal") || normalized.includes("常规")) {
    return "Regular";
  }
  if (normalized.includes("extra bold")) {
    return "Extra Bold";
  }

  return value;
}

async function setTextContent(node: any, value: string) {
  if (!supportsText(node)) {
    return false;
  }

  await loadNodeFonts(node);
  node.characters = value;
  return true;
}

async function setTextFontSize(node: any, value: number) {
  if (!supportsText(node)) {
    return false;
  }

  await loadNodeFonts(node);
  node.fontSize = value;
  return true;
}

async function setTextFontFamily(node: any, family: string, style?: string) {
  if (!supportsText(node)) {
    return false;
  }

  const primaryFont = getPrimaryFontName(node);
  const targetFont = {
    family,
    style: style || primaryFont?.style || "Regular",
  };

  await figma.loadFontAsync(targetFont);
  node.fontName = targetFont;
  return true;
}

async function setTextFontWeight(node: any, value: number | string) {
  if (!supportsText(node)) {
    return false;
  }

  const primaryFont = getPrimaryFontName(node);
  if (!primaryFont) {
    throw new Error("当前文本节点缺少可用字体信息。");
  }

  const targetFont = {
    family: primaryFont.family,
    style: String(normalizeFontWeightStyle(value)),
  };

  await figma.loadFontAsync(targetFont);
  node.fontName = targetFont;
  return true;
}

function setTextColor(node: any, hex: string) {
  if (!supportsText(node)) {
    return false;
  }

  node.fills = [createSolidPaint(hex)];
  node.fillStyleId = "";
  return true;
}

async function setTextLineHeight(node: any, value: number) {
  if (!supportsText(node)) {
    return false;
  }

  await loadNodeFonts(node);
  node.lineHeight = { value, unit: "PIXELS" };
  return true;
}

async function setTextLetterSpacing(node: any, value: number) {
  if (!supportsText(node)) {
    return false;
  }

  await loadNodeFonts(node);
  node.letterSpacing = { value, unit: "PIXELS" };
  return true;
}

function normalizeTextAlignment(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "left" || normalized === "左对齐") return "LEFT";
  if (normalized === "center" || normalized === "居中" || normalized === "居中对齐") return "CENTER";
  if (normalized === "right" || normalized === "右对齐") return "RIGHT";
  if (normalized === "justified" || normalized === "两端对齐") return "JUSTIFIED";
  throw new Error(`不支持的文本对齐值: ${value}`);
}

function setTextAlignment(node: any, value: string) {
  if (!supportsText(node)) {
    return false;
  }

  node.textAlignHorizontal = normalizeTextAlignment(value);
  return true;
}

function applyRadiusToNode(node: any, value: number) {
  if (!supportsCornerRadius(node)) {
    return false;
  }

  node.cornerRadius = value;
  return true;
}

function applyOpacityToNode(node: any, value: number) {
  node.opacity = Math.max(0, Math.min(1, value / 100));
  return true;
}

async function upsertPaintStyle(name: string, hex: string, applyToSelection?: boolean) {
  const normalizedHex = normalizeHex(hex);
  const paint = createSolidPaint(normalizedHex);
  const localStyles = await figma.getLocalPaintStylesAsync();
  let style = localStyles.find((item: any) => item.name === name);

  if (!style) {
    style = figma.createPaintStyle();
    style.name = name;
  }

  style.paints = [paint];

  const changedNodeIds: string[] = [];
  const warnings: string[] = [];
  if (applyToSelection) {
    for (const node of getSelection()) {
      try {
        if (!supportsFills(node)) {
          continue;
        }
        node.fillStyleId = style.id;
        changedNodeIds.push(node.id);
      } catch {
        warnings.push(`${node.name || node.id} 无法应用样式覆盖。`);
      }
    }
  }

  return {
    style,
    changedNodeIds,
    warnings,
  };
}

async function upsertTextStyle(
  name: string,
  fontFamily: string,
  fontSize: number,
  fontStyle?: string,
  textColorHex?: string,
) {
  const targetFont = {
    family: fontFamily,
    style: fontStyle || "Regular",
  };
  await figma.loadFontAsync(targetFont);

  const localStyles = await figma.getLocalTextStylesAsync();
  let style = localStyles.find((item: any) => item.name === name);

  if (!style) {
    style = figma.createTextStyle();
    style.name = name;
  }

  style.fontName = targetFont;
  style.fontSize = fontSize;
  style.fills = [createSolidPaint(textColorHex || "#111111")];

  return {
    style,
  };
}

function applyPaintStyleToNode(node: any, styleId: string) {
  if (!supportsFills(node)) {
    return false;
  }

  node.fillStyleId = styleId;
  return true;
}

function applyTextStyleToNode(node: any, styleId: string) {
  if (!supportsText(node)) {
    return false;
  }

  node.textStyleId = styleId;
  return true;
}

function detachStyleFromNode(node: any, styleType: "fill" | "stroke" | "text") {
  switch (styleType) {
    case "fill":
      if (!supportsFills(node)) {
        return false;
      }
      node.fillStyleId = "";
      return true;
    case "stroke":
      if (!supportsStrokes(node)) {
        return false;
      }
      node.strokeStyleId = "";
      return true;
    case "text":
      if (!supportsText(node)) {
        return false;
      }
      node.textStyleId = "";
      return true;
    default:
      return styleType satisfies never;
  }
}

async function upsertColorVariable(
  collectionName: string,
  variableName: string,
  hex: string,
  bindToSelection?: boolean,
) {
  const normalizedHex = normalizeHex(hex);
  const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = localCollections.find((item: any) => item.name === collectionName);

  if (!collection) {
    collection = figma.variables.createVariableCollection(collectionName);
  }

  const modeId = collection.modes[0].modeId;
  const localVariables = await figma.variables.getLocalVariablesAsync("COLOR");
  let variable = localVariables.find(
    (item: any) => item.name === variableName && item.variableCollectionId === collection.id,
  );

  if (!variable) {
    variable = figma.variables.createVariable(variableName, collection, "COLOR");
  }

  const rgb = createSolidPaint(normalizedHex).color;
  variable.setValueForMode(modeId, {
    r: rgb.r,
    g: rgb.g,
    b: rgb.b,
    a: 1,
  });

  const changedNodeIds: string[] = [];
  const warnings: string[] = [];
  if (bindToSelection) {
    for (const node of getSelection()) {
      try {
        if (!supportsFills(node) || node.fills === figma.mixed) {
          continue;
        }

        if (getBoundFillVariableIds(node).includes(variable.id)) {
          changedNodeIds.push(node.id);
          continue;
        }

        const fills = clonePaints(node.fills);
        const firstPaint =
          fills[0] && fills[0].type === "SOLID" ? fills[0] : createSolidPaint(normalizedHex);
        fills[0] = figma.variables.setBoundVariableForPaint(firstPaint, "color", variable);
        node.fills = fills;
        changedNodeIds.push(node.id);
      } catch (error) {
        warnings.push(
          `${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`,
        );
      }
    }

    if (!changedNodeIds.length) {
      throw new Error(
        warnings[0] ||
          "变量已创建或更新，但当前 selection 中没有可绑定颜色变量的 fill 节点。请选中带实体填充的形状、文本、Frame 或可写实例。",
      );
    }
  }

  return {
    collection,
    variable,
    changedNodeIds,
    warnings,
  };
}

async function getTargetNodes(
  command: FigmaCapabilityCommand,
  batchSource?: string,
): Promise<ReturnType<typeof getSelection>> {
  const selection = getSelection();
  if (!command.nodeIds || command.nodeIds.length === 0) {
    if (
      batchSource === "codex" &&
      requiresExplicitNodeIdsForExternalCapability(command.capabilityId)
    ) {
      throw new Error(
        `外部修改命令必须指定 nodeIds。capability=${command.capabilityId}，当前 selection=${selection.length}。请在命令中添加 nodeIds 以明确目标。`,
      );
    }
    return selection;
  }
  const idSet = new Set(command.nodeIds);
  const filtered = selection.filter((node: (typeof selection)[number]) => idSet.has(node.id));
  if (filtered.length) {
    return filtered;
  }

  if (batchSource === "codex") {
    const resolved = (
      await Promise.all(
        command.nodeIds.map(async (nodeId) => {
          try {
            return (await figma.getNodeByIdAsync(nodeId)) as (typeof selection)[number] | null;
          } catch {
            return null;
          }
        }),
      )
    ).filter(Boolean) as ReturnType<typeof getSelection>;

    if (resolved.length) {
      return resolved;
    }
  }

  if (!filtered.length) {
    throw new Error(
      `指定的 nodeIds 在当前 selection 中未找到匹配节点。nodeIds: ${command.nodeIds.join(", ")}`,
    );
  }
  return filtered;
}

async function runCapabilityCommand(
  command: FigmaCapabilityCommand,
  batchSource?: string,
): Promise<PluginCommandExecutionResult> {
  const descriptor = getPluginCapabilityDescriptor(command.capabilityId);
  if (!descriptor) {
    return failureResult(command.capabilityId, `未注册的能力: ${command.capabilityId}`, {
      errorCode: "unsupported_capability",
    });
  }

  if (command.dryRun) {
    return successResult(command.capabilityId, `Dry run: ${descriptor.label}`, {
      warnings: ["dryRun=true，本次未实际修改 Figma 文件。"],
    });
  }

  if (
    batchSource === "codex" &&
    requiresExplicitNodeIdsForExternalCapability(command.capabilityId) &&
    !hasExplicitCreationParent(command) &&
    (!command.nodeIds || command.nodeIds.length === 0)
  ) {
    throw new Error(`外部修改命令必须指定 nodeIds。capability=${command.capabilityId}。`);
  }

  // Capture undo snapshot before execution (for property-modifying capabilities)
  let undoEntry: UndoEntry | null = null;
  if (!NON_UNDOABLE_CAPABILITIES.has(command.capabilityId) && !CREATION_CAPABILITIES.has(command.capabilityId)) {
    try {
      const targetNodes = await getTargetNodes(command, batchSource);
      const snapshots: PropertySnapshot[] = [];
      for (const node of targetNodes) {
        const props = snapshotNodeProperties(node, command.capabilityId);
        if (props) {
          snapshots.push({ nodeId: node.id, properties: props });
        }
      }
      if (snapshots.length > 0) {
        undoEntry = { capabilityId: command.capabilityId, snapshots, createdNodeIds: [] };
      }
    } catch {
      // If getTargetNodes throws (e.g., no selection), let the main switch handle it
    }
  }

  const result = await runCapabilityCommandInner(command, batchSource);

  // Push undo entry if command succeeded
  if (result.ok) {
    if (undoEntry) {
      undoStack.push(undoEntry);
      if (undoStack.length > UNDO_STACK_MAX) undoStack.shift();
    } else if (CREATION_CAPABILITIES.has(command.capabilityId) && result.changedNodeIds.length > 0) {
      undoStack.push({
        capabilityId: command.capabilityId,
        snapshots: [],
        createdNodeIds: result.changedNodeIds,
      });
      if (undoStack.length > UNDO_STACK_MAX) undoStack.shift();
    }
  }

  return result;
}

async function runCapabilityCommandInner(
  command: FigmaCapabilityCommand,
  batchSource?: string,
): Promise<PluginCommandExecutionResult> {
  switch (command.capabilityId) {
    case "selection.refresh":
      return successResult(command.capabilityId, "已刷新当前 selection。");

    case "nodes.inspect-subtree": {
      const payload = command.payload as { nodeId: string; maxDepth?: number };
      const nodeId = String(payload.nodeId || "").trim();
      if (!nodeId) {
        throw new Error("inspect-subtree 需要 nodeId。");
      }
      let root: any = null;
      try {
        root = await figma.getNodeByIdAsync(nodeId);
      } catch {
        root = null;
      }
      if (!root) {
        throw new Error(`未找到节点: ${nodeId}`);
      }
      const inspectedNodes = inspectNodeSubtree(root, { maxDepth: payload.maxDepth });
      return successResult(command.capabilityId, `已检查节点子树 "${root.name || root.id}"。`, {
        inspectedNodes,
      });
    }

    case "fills.set-fill": {
      const payload = command.payload as { hex: string };
      const paint = createSolidPaint(payload.hex);
      const changedNodeIds: string[] = [];

      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (applyFillToNode(node, paint)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可写 fill 的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的 fill 改为 ${normalizeHex(payload.hex)}。`,
        {
          changedNodeIds,
        },
      );
    }

    case "fills.clear-fill": {
      const changedNodeIds: string[] = [];

      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (clearFillOnNode(node)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可清空 fill 的节点。");
      }

      return successResult(command.capabilityId, `已清空 ${changedNodeIds.length} 个节点的 fill。`, {
        changedNodeIds,
      });
    }

    case "strokes.set-stroke": {
      const payload = command.payload as { hex: string };
      const paint = createSolidPaint(payload.hex);
      const changedNodeIds: string[] = [];

      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (applyStrokeToNode(node, paint)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可写 stroke 的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的 stroke 改为 ${normalizeHex(payload.hex)}。`,
        {
          changedNodeIds,
        },
      );
    }

    case "strokes.clear-stroke": {
      const changedNodeIds: string[] = [];

      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (clearStrokeOnNode(node)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可清空 stroke 的节点。");
      }

      return successResult(
        command.capabilityId,
        `已清空 ${changedNodeIds.length} 个节点的 stroke。`,
        {
          changedNodeIds,
        },
      );
    }

    case "strokes.set-weight": {
      const payload = command.payload as { value: number };
      if (!Number.isFinite(payload.value) || payload.value < 0) {
        throw new Error("描边粗细必须是大于等于 0 的数字。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];

      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          const result = applyStrokeWeightToNode(node, payload.value);
          if (result.changed) {
            changedNodeIds.push(node.id);
          } else if (result.warning) {
            warnings.push(result.warning);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可写描边粗细的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的描边粗细设为 ${payload.value}px。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "effects.set-shadow": {
      const payload = command.payload as {
        offsetX: number;
        offsetY: number;
        blur: number;
        spread?: number;
        colorHex?: string;
        opacity?: number;
      };
      if (
        !Number.isFinite(payload.offsetX) ||
        !Number.isFinite(payload.offsetY) ||
        !Number.isFinite(payload.blur)
      ) {
        throw new Error("阴影参数必须包含有效的 offsetX、offsetY 和 blur 数值。");
      }

      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (setShadowOnNode(node, payload)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可写阴影效果的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的阴影更新为 offset(${payload.offsetX}, ${payload.offsetY}) blur ${payload.blur}。`,
        {
          changedNodeIds,
        },
      );
    }

    case "effects.set-layer-blur": {
      const payload = command.payload as { radius: number };
      if (!Number.isFinite(payload.radius) || payload.radius < 0) {
        throw new Error("图层模糊半径必须是大于等于 0 的数字。");
      }

      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (setLayerBlurOnNode(node, payload.radius)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可写图层模糊的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的图层模糊设为 ${payload.radius}px。`,
        {
          changedNodeIds,
        },
      );
    }

    case "effects.clear-effects": {
      const changedNodeIds: string[] = [];

      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (clearEffectsOnNode(node)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可清空 effects 的节点。");
      }

      return successResult(command.capabilityId, `已清空 ${changedNodeIds.length} 个节点的效果。`, {
        changedNodeIds,
      });
    }

    case "geometry.set-radius": {
      const payload = command.payload as { value: number };
      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (applyRadiusToNode(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore nodes that cannot accept radius changes.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可写圆角的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的圆角设为 ${payload.value}px。`,
        {
          changedNodeIds,
        },
      );
    }

    case "geometry.set-size": {
      const payload = command.payload as { width: number; height: number };
      if (
        !Number.isFinite(payload.width) ||
        !Number.isFinite(payload.height) ||
        payload.width <= 0 ||
        payload.height <= 0
      ) {
        throw new Error("宽高必须是大于 0 的数字。");
      }

      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (resizeNode(node, payload.width, payload.height)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore nodes that cannot be resized.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可改尺寸的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的尺寸设为 ${payload.width} x ${payload.height}px。`,
        {
          changedNodeIds,
        },
      );
    }

    case "geometry.set-position": {
      const payload = command.payload as { x: number; y: number };
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) {
        throw new Error("位置必须包含有效的 x 和 y 数字。");
      }

      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (moveNode(node, payload.x, payload.y)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore nodes that cannot be moved.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可改位置的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点移动到 (${payload.x}, ${payload.y})。`,
        {
          changedNodeIds,
        },
      );
    }

    case "nodes.set-opacity": {
      const payload = command.payload as { value: number };
      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (applyOpacityToNode(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore nodes that cannot accept opacity changes.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可写透明度的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的透明度设为 ${payload.value}%。`,
        {
          changedNodeIds,
        },
      );
    }

    case "nodes.rename": {
      const payload = command.payload as { name: string };
      const name = String(payload.name || "").trim();
      if (!name) {
        throw new Error("节点名称不能为空。");
      }

      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (renameNode(node, name)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable names.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可重命名的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点重命名为 ${name}。`,
        {
          changedNodeIds,
        },
      );
    }

    case "nodes.duplicate": {
      const payload = command.payload as { offsetX?: number; offsetY?: number };
      const offsetX = Number.isFinite(payload.offsetX) ? Number(payload.offsetX) : 24;
      const offsetY = Number.isFinite(payload.offsetY) ? Number(payload.offsetY) : 24;

      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          const duplicated = duplicateNode(node, offsetX, offsetY);
          if (duplicated) {
            changedNodeIds.push(duplicated.id);
          }
        } catch {
          // Ignore nodes that cannot be duplicated.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可复制的节点。");
      }

      return successResult(
        command.capabilityId,
        `已复制 ${changedNodeIds.length} 个节点，并偏移 (${offsetX}, ${offsetY})。`,
        {
          changedNodeIds,
        },
      );
    }

    case "nodes.group": {
      const payload = command.payload as { name?: string };
      const group = groupNodes(await getTargetNodes(command, batchSource), payload.name);

      return successResult(
        command.capabilityId,
        `已将当前 selection 分组为 ${group.name}。`,
        {
          changedNodeIds: [group.id],
        },
      );
    }

    case "nodes.frame-selection": {
      const payload = command.payload as { name?: string; padding?: number };
      if (payload.padding !== undefined && (!Number.isFinite(payload.padding) || payload.padding < 0)) {
        throw new Error("Frame padding 必须是大于等于 0 的数字。");
      }

      const frame = frameNodes(await getTargetNodes(command, batchSource), payload);

      return successResult(
        command.capabilityId,
        `已使用 Frame 包裹当前 selection${payload.name ? `，名称为 ${frame.name}` : ""}。`,
        {
          changedNodeIds: [frame.id],
        },
      );
    }

    case "layout.configure-frame": {
      const payload = command.payload as {
        layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
        primaryAxisSizingMode?: "FIXED" | "AUTO";
        counterAxisSizingMode?: "FIXED" | "AUTO";
        primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
        counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
        itemSpacing?: number;
        paddingLeft?: number;
        paddingRight?: number;
        paddingTop?: number;
        paddingBottom?: number;
        clipsContent?: boolean;
      };
      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        configureFrameLayout(node, payload);
        changedNodeIds.push(node.id);
      }
      return successResult(command.capabilityId, `已配置 ${changedNodeIds.length} 个 Frame 的布局属性。`, {
        changedNodeIds,
      });
    }

    case "layout.configure-child": {
      const payload = command.payload as {
        layoutAlign?: "INHERIT" | "STRETCH" | "MIN" | "CENTER" | "MAX";
        layoutGrow?: number;
        layoutPositioning?: "AUTO" | "ABSOLUTE";
      };
      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        configureChildLayout(node, payload);
        changedNodeIds.push(node.id);
      }
      return successResult(command.capabilityId, `已配置 ${changedNodeIds.length} 个子节点的布局属性。`, {
        changedNodeIds,
      });
    }

    case "assets.export-node-image": {
      const payload = command.payload as {
        format?: "PNG";
        constraint?: { type: "WIDTH" | "HEIGHT" | "SCALE"; value: number };
        preferOriginalBytes?: boolean;
      };
      const targets = await getTargetNodes(command, batchSource);
      const exportedImages = [];
      const warnings: string[] = [];

      for (const node of targets) {
        const artifact = await exportNodeImageArtifact(node, {
          preferOriginalBytes: payload.preferOriginalBytes,
          constraint: payload.constraint,
        });
        if (!artifact) {
          warnings.push(`${node.name || node.id} 当前无法导出为图片。`);
          continue;
        }
        exportedImages.push(artifact);
      }

      if (!exportedImages.length) {
        throw new Error(warnings[0] || "没有成功导出任何节点图片。");
      }

      return successResult(
        command.capabilityId,
        `已导出 ${exportedImages.length} 个节点图片。`,
        {
          exportedImages,
          warnings,
        },
      );
    }

    case "reconstruction.apply-raster-reference": {
      const payload = command.payload as {
        referenceNodeId?: string;
        referenceDataUrl?: string;
        resultName?: string;
        replaceTargetContents?: boolean;
        resizeTargetToReference?: boolean;
        fitMode?: "cover" | "contain" | "stretch";
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        opacity?: number;
      };
      if (
        !(typeof payload.referenceNodeId === "string" && payload.referenceNodeId.trim()) &&
        !(typeof payload.referenceDataUrl === "string" && payload.referenceDataUrl.trim())
      ) {
        throw new Error("referenceNodeId 或 referenceDataUrl 至少需要一个。");
      }

      const targets = await getTargetNodes(command, batchSource);
      if (targets.length !== 1) {
        throw new Error("raster reconstruction 需要且只支持一个目标 Frame。");
      }

      const target = targets[0];
      if (target.type !== "FRAME") {
        throw new Error(`raster reconstruction 目标节点必须是 FRAME，当前为 ${target.type}。`);
      }

      const artifact =
        typeof payload.referenceDataUrl === "string" && payload.referenceDataUrl.trim()
          ? (() => {
              const { bytes, mimeType } = decodeDataUrl(payload.referenceDataUrl as string);
              return {
                dataUrl: payload.referenceDataUrl as string,
                bytes,
                mimeType,
                width: Number.isFinite(payload.width) ? Number(payload.width) : target.width,
                height: Number.isFinite(payload.height) ? Number(payload.height) : target.height,
              };
            })()
          : await (async () => {
              const referenceNode = await figma.getNodeByIdAsync(String(payload.referenceNodeId));
              if (!referenceNode) {
                throw new Error(`referenceNodeId "${payload.referenceNodeId}" 未找到。`);
              }
              const exported = await exportNodeImageArtifact(referenceNode, {
                preferOriginalBytes: true,
              });
              if (!exported) {
                throw new Error("参考节点无法导出为图片。");
              }
              return exported;
            })();

      if (payload.replaceTargetContents !== false && supportsChildren(target)) {
        for (const child of [...target.children]) {
          child.remove();
        }
      }

      if (payload.resizeTargetToReference !== false) {
        if (typeof artifact.width !== "number" || typeof artifact.height !== "number" || artifact.width <= 0 || artifact.height <= 0) {
          throw new Error("参考图片尺寸无效，无法调整目标 Frame。");
        }
        target.resize(artifact.width, artifact.height);
      }

      const image = figma.createImage(
        "bytes" in artifact && artifact.bytes ? artifact.bytes : decodeDataUrl(artifact.dataUrl).bytes,
      );
      const rasterNode = figma.createRectangle();
      target.appendChild(rasterNode);
      rasterNode.name = payload.resultName?.trim() || "AD Raster";
      const targetWidth = Math.max(1, Math.round(typeof target.width === "number" ? target.width : artifact.width));
      const targetHeight = Math.max(1, Math.round(typeof target.height === "number" ? target.height : artifact.height));
      const fitMode = payload.fitMode || "cover";
      const hasExplicitBounds =
        Number.isFinite(payload.x) &&
        Number.isFinite(payload.y) &&
        Number.isFinite(payload.width) &&
        Number.isFinite(payload.height);
      const placement = hasExplicitBounds
        ? {
            x: Math.round(Number(payload.x)),
            y: Math.round(Number(payload.y)),
            width: Math.max(1, Math.round(Number(payload.width))),
            height: Math.max(1, Math.round(Number(payload.height))),
            scaleMode: "FILL" as const,
          }
        : computeRasterPlacement(
            targetWidth,
            targetHeight,
            Math.max(1, Number(artifact.width || targetWidth)),
            Math.max(1, Number(artifact.height || targetHeight)),
            fitMode,
          );

      rasterNode.resize(placement.width, placement.height);
      rasterNode.x = placement.x;
      rasterNode.y = placement.y;
      if ("strokes" in rasterNode) {
        rasterNode.strokes = [];
      }
      if ("cornerRadius" in rasterNode) {
        rasterNode.cornerRadius = 0;
      }
      if ("layoutMode" in target && target.layoutMode !== "NONE" && "layoutPositioning" in rasterNode) {
        rasterNode.layoutPositioning = "ABSOLUTE";
      }
      if ("clipsContent" in target) {
        target.clipsContent = true;
      }
      rasterNode.fills = [
        {
          type: "IMAGE",
          imageHash: image.hash,
          scaleMode: placement.scaleMode,
          visible: true,
          opacity:
            Number.isFinite(payload.opacity) && Number(payload.opacity) >= 0 && Number(payload.opacity) <= 1
              ? Number(payload.opacity)
              : 1,
        },
      ];

      return successResult(
        command.capabilityId,
        `已将参考图精确写入目标 Frame "${target.name}"。`,
        {
          changedNodeIds: [rasterNode.id],
        },
      );
    }

    case "nodes.delete": {
      const changedNodeIds: string[] = [];
      const warnings: string[] = [];

      // nodes.delete supports deleting by nodeIds directly (not just selection)
      const targetIds = command.nodeIds && command.nodeIds.length > 0
        ? command.nodeIds
        : (await getTargetNodes(command, batchSource)).map((n: any) => n.id);

      for (const nodeId of targetIds) {
        try {
          const node = await figma.getNodeByIdAsync(nodeId);
          if (!node) {
            warnings.push(`节点 ${nodeId} 未找到。`);
            continue;
          }
          if (node.parent) {
            changedNodeIds.push(node.id);
            node.remove();
          } else {
            warnings.push(`节点 ${nodeId} (${(node as any).name}) 是根节点，无法删除。`);
          }
        } catch (error) {
          warnings.push(
            `删除节点 ${nodeId} 失败: ${error instanceof Error ? error.message : "未知错误"}`,
          );
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("没有成功删除任何节点。");
      }

      return successResult(
        command.capabilityId,
        `已删除 ${changedNodeIds.length} 个节点。`,
        { changedNodeIds, warnings },
      );
    }

    case "nodes.set-clips-content": {
      const payload = command.payload as { value: boolean };
      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        if (!supportsClipsContent(node)) {
          throw new Error(`${node.name || node.id} 不支持 clipsContent。`);
        }
        node.clipsContent = Boolean(payload.value);
        changedNodeIds.push(node.id);
      }
      return successResult(command.capabilityId, `已更新 ${changedNodeIds.length} 个节点的 clipsContent。`, {
        changedNodeIds,
      });
    }

    case "nodes.set-mask": {
      const payload = command.payload as { value: boolean };
      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        if (!supportsMasking(node)) {
          throw new Error(`${node.name || node.id} 不支持 mask。`);
        }
        node.isMask = Boolean(payload.value);
        changedNodeIds.push(node.id);
      }
      return successResult(command.capabilityId, `已更新 ${changedNodeIds.length} 个节点的 mask 状态。`, {
        changedNodeIds,
      });
    }

    case "components.create-component": {
      const payload = command.payload as { name?: string };
      const targets = await getTargetNodes(command, batchSource);
      if (targets.length !== 1) {
        throw new Error("create-component 需要且仅支持一个目标节点。");
      }
      const component = figma.createComponentFromNode(targets[0]);
      if (payload.name && payload.name.trim()) {
        component.name = payload.name.trim();
      }
      return successResult(command.capabilityId, `已创建组件 "${component.name}"。`, {
        changedNodeIds: [component.id],
      });
    }

    case "components.create-instance": {
      const payload = command.payload as {
        mainComponentNodeId: string;
        x?: number;
        y?: number;
        parentNodeId?: string;
        name?: string;
      };
      if (!String(payload.mainComponentNodeId || "").trim()) {
        throw new Error("components.create-instance 需要 mainComponentNodeId。");
      }
      const component = await resolveComponentNode(String(payload.mainComponentNodeId));
      const parent = await resolveParentNode(payload.parentNodeId);
      const instance = component.createInstance();
      parent.appendChild(instance);
      if (payload.name && payload.name.trim()) {
        instance.name = payload.name.trim();
      }
      if (Number.isFinite(payload.x)) {
        instance.x = Number(payload.x);
      }
      if (Number.isFinite(payload.y)) {
        instance.y = Number(payload.y);
      }
      return successResult(command.capabilityId, `已创建组件实例 "${instance.name}"。`, {
        changedNodeIds: [instance.id],
      });
    }

    case "components.detach-instance": {
      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        if (node.type !== "INSTANCE" || typeof node.detachInstance !== "function") {
          throw new Error(`${node.name || node.id} 不是可 detach 的实例节点。`);
        }
        const detached = node.detachInstance();
        changedNodeIds.push(detached.id);
      }
      return successResult(command.capabilityId, `已 detach ${changedNodeIds.length} 个实例。`, {
        changedNodeIds,
      });
    }

    case "nodes.create-frame": {
      const payload = command.payload as {
        name?: string;
        width: number;
        height: number;
        x?: number;
        y?: number;
        fillHex?: string;
        cornerRadius?: number;
        parentNodeId?: string;
      };

      if (
        !Number.isFinite(payload.width) ||
        !Number.isFinite(payload.height) ||
        payload.width <= 0 ||
        payload.height <= 0
      ) {
        throw new Error("Frame 的宽高必须是大于 0 的数字。");
      }

      const parent = await resolveParentNode(payload.parentNodeId);
      const frame = figma.createFrame();
      parent.appendChild(frame);

      frame.resize(payload.width, payload.height);

      if (payload.name && payload.name.trim()) {
        frame.name = payload.name.trim();
      }

      if (Number.isFinite(payload.x)) {
        frame.x = payload.x!;
      }
      if (Number.isFinite(payload.y)) {
        frame.y = payload.y!;
      }

      if (payload.fillHex) {
        frame.fills = [createSolidPaint(payload.fillHex)];
      }

      if (payload.cornerRadius !== undefined) {
        if (!Number.isFinite(payload.cornerRadius) || payload.cornerRadius < 0) {
          throw new Error("cornerRadius 必须是大于等于 0 的数字。");
        }
        frame.cornerRadius = payload.cornerRadius;
      }

      return successResult(
        command.capabilityId,
        `已创建 Frame "${frame.name}" (${payload.width} × ${payload.height})。`,
        {
          changedNodeIds: [frame.id],
        },
      );
    }

    case "nodes.create-text": {
      const payload = command.payload as {
        name?: string;
        content: string;
        fontFamily?: string;
        fontStyle?: string;
        fontSize?: number;
        fontWeight?: number | string;
        colorHex?: string;
        lineHeight?: number;
        letterSpacing?: number;
        alignment?: "left" | "center" | "right" | "justified";
        x?: number;
        y?: number;
        parentNodeId?: string;
        analysisRefId?: string;
      };

      if (!String(payload.content || "").length) {
        throw new Error("文本内容不能为空。");
      }

      const fontFamily = payload.fontFamily?.trim() || "Inter";
      let fontStyle = payload.fontStyle?.trim() || "Regular";

      if (payload.fontWeight !== undefined && !payload.fontStyle) {
        fontStyle = String(normalizeFontWeightStyle(payload.fontWeight));
      }

      const targetFont = { family: fontFamily, style: fontStyle };
      await figma.loadFontAsync(targetFont);

      const parent = await resolveParentNode(payload.parentNodeId);
      const textNode = figma.createText();
      parent.appendChild(textNode);

      if (payload.name && payload.name.trim()) {
        textNode.name = payload.name.trim();
      }

      textNode.fontName = targetFont;
      textNode.characters = payload.content;

      if (payload.fontSize !== undefined) {
        if (!Number.isFinite(payload.fontSize) || payload.fontSize <= 0) {
          throw new Error("字号必须是大于 0 的数字。");
        }
        textNode.fontSize = payload.fontSize;
      }

      if (payload.colorHex) {
        textNode.fills = [createSolidPaint(payload.colorHex)];
      }

      if (payload.lineHeight !== undefined) {
        if (!Number.isFinite(payload.lineHeight) || payload.lineHeight <= 0) {
          throw new Error("行高必须是大于 0 的数字。");
        }
        textNode.lineHeight = { value: payload.lineHeight, unit: "PIXELS" };
      }

      if (payload.letterSpacing !== undefined) {
        if (!Number.isFinite(payload.letterSpacing)) {
          throw new Error("字距必须是有效数字。");
        }
        textNode.letterSpacing = { value: payload.letterSpacing, unit: "PIXELS" };
      }

      if (payload.alignment) {
        textNode.textAlignHorizontal = normalizeTextAlignment(payload.alignment);
      }

      if (Number.isFinite(payload.x)) {
        textNode.x = payload.x!;
      }
      if (Number.isFinite(payload.y)) {
        textNode.y = payload.y!;
      }

      const preview =
        payload.content.length > 30
          ? payload.content.substring(0, 30) + "…"
          : payload.content;

      return successResult(
        command.capabilityId,
        `已创建文本节点 "${textNode.name}" 内容为 "${preview}"。`,
        {
          changedNodeIds: [textNode.id],
        },
      );
    }

    case "nodes.create-rectangle": {
      const payload = command.payload as {
        name?: string;
        width: number;
        height: number;
        x?: number;
        y?: number;
        placement?: "above" | "below" | "left" | "right";
        gap?: number;
        fillHex?: string;
        strokeHex?: string;
        strokeWeight?: number;
        cornerRadius?: number;
        opacity?: number;
        parentNodeId?: string;
      };
      if (!Number.isFinite(payload.width) || payload.width <= 0 || !Number.isFinite(payload.height) || payload.height <= 0) {
        throw new Error("Rectangle 的宽高必须是大于 0 的数字。");
      }

      const anchorNode = payload.placement
        ? await resolveAnchorNodeForCreation(command)
        : null;
      const parent = payload.parentNodeId
        ? await resolveParentNode(payload.parentNodeId)
        : anchorNode && anchorNode.parent
          ? anchorNode.parent
          : await resolveParentNode(undefined);
      let position = {
        x: Number.isFinite(payload.x) ? Number(payload.x) : undefined,
        y: Number.isFinite(payload.y) ? Number(payload.y) : undefined,
      };
      if (payload.placement) {
        const gap = payload.gap === undefined ? 16 : Number(payload.gap);
        if (!Number.isFinite(gap) || gap < 0) {
          throw new Error("relative placement gap 必须是大于等于 0 的数字。");
        }
        if (getSceneRoot(anchorNode) !== getSceneRoot(parent)) {
          throw new Error("relative placement 要求锚点节点和目标 parent 位于同一页面场景树。");
        }
        const absolutePosition = computeRelativePlacement(
          anchorNode,
          { width: payload.width, height: payload.height },
          payload.placement,
          gap,
        );
        position = toLocalPosition(parent, absolutePosition);
      }
      const node = figma.createRectangle();
      parent.appendChild(node);
      if (parentUsesAutoLayout(parent)) {
        if (!("layoutPositioning" in node)) {
          throw new Error("目标父级启用了 Auto Layout，但新矩形不支持 absolute positioning。");
        }
        node.layoutPositioning = "ABSOLUTE";
      }
      node.resize(payload.width, payload.height);
      if (payload.name && payload.name.trim()) {
        node.name = payload.name.trim();
      }
      if (Number.isFinite(position.x)) {
        node.x = Number(position.x);
      }
      if (Number.isFinite(position.y)) {
        node.y = Number(position.y);
      }
      if (payload.cornerRadius !== undefined) {
        if (!Number.isFinite(payload.cornerRadius) || payload.cornerRadius < 0) {
          throw new Error("cornerRadius 必须是大于等于 0 的数字。");
        }
        node.cornerRadius = payload.cornerRadius;
      }
      applyFillStrokeOpacity(node, payload);
      return successResult(
        command.capabilityId,
        `已创建矩形节点 "${node.name}"。`,
        { changedNodeIds: [node.id] },
      );
    }

    case "nodes.create-ellipse": {
      const payload = command.payload as {
        name?: string;
        width: number;
        height: number;
        x?: number;
        y?: number;
        fillHex?: string;
        strokeHex?: string;
        strokeWeight?: number;
        opacity?: number;
        parentNodeId?: string;
      };
      if (!Number.isFinite(payload.width) || payload.width <= 0 || !Number.isFinite(payload.height) || payload.height <= 0) {
        throw new Error("Ellipse 的宽高必须是大于 0 的数字。");
      }

      const parent = await resolveParentNode(payload.parentNodeId);
      const node = figma.createEllipse();
      parent.appendChild(node);
      node.resize(payload.width, payload.height);
      if (payload.name && payload.name.trim()) {
        node.name = payload.name.trim();
      }
      if (Number.isFinite(payload.x)) {
        node.x = Number(payload.x);
      }
      if (Number.isFinite(payload.y)) {
        node.y = Number(payload.y);
      }
      applyFillStrokeOpacity(node, payload);
      return successResult(
        command.capabilityId,
        `已创建椭圆节点 "${node.name}"。`,
        { changedNodeIds: [node.id] },
      );
    }

    case "nodes.create-line": {
      const payload = command.payload as {
        name?: string;
        width: number;
        height?: number;
        x?: number;
        y?: number;
        strokeHex?: string;
        strokeWeight?: number;
        opacity?: number;
        rotation?: number;
        parentNodeId?: string;
      };
      if (!Number.isFinite(payload.width) || payload.width <= 0) {
        throw new Error("Line 的 width 必须是大于 0 的数字。");
      }

      const parent = await resolveParentNode(payload.parentNodeId);
      const node = figma.createLine();
      parent.appendChild(node);
      node.resize(payload.width, Number.isFinite(payload.height) ? Math.max(1, Number(payload.height)) : 1);
      if (payload.name && payload.name.trim()) {
        node.name = payload.name.trim();
      }
      if (Number.isFinite(payload.x)) {
        node.x = Number(payload.x);
      }
      if (Number.isFinite(payload.y)) {
        node.y = Number(payload.y);
      }
      if (Number.isFinite(payload.rotation)) {
        node.rotation = Number(payload.rotation);
      }
      applyFillStrokeOpacity(node, {
        strokeHex: payload.strokeHex || "#000000",
        strokeWeight: payload.strokeWeight ?? 1,
        opacity: payload.opacity,
      });
      return successResult(
        command.capabilityId,
        `已创建线段节点 "${node.name}"。`,
        { changedNodeIds: [node.id] },
      );
    }

    case "nodes.create-svg": {
      const payload = command.payload as {
        name?: string;
        svgMarkup: string;
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        opacity?: number;
        parentNodeId?: string;
      };
      if (!String(payload.svgMarkup || "").trim()) {
        throw new Error("svgMarkup 不能为空。");
      }

      const parent = await resolveParentNode(payload.parentNodeId);
      const node = figma.createNodeFromSvg(payload.svgMarkup);
      if (node.parent !== parent) {
        parent.appendChild(node);
      }
      if (payload.name && payload.name.trim()) {
        node.name = payload.name.trim();
      }
      if (Number.isFinite(payload.width) && Number.isFinite(payload.height) && "resize" in node) {
        node.resize(Number(payload.width), Number(payload.height));
      }
      if (Number.isFinite(payload.x)) {
        node.x = Number(payload.x);
      }
      if (Number.isFinite(payload.y)) {
        node.y = Number(payload.y);
      }
      if (payload.opacity !== undefined && "opacity" in node) {
        if (!Number.isFinite(payload.opacity) || payload.opacity < 0 || payload.opacity > 1) {
          throw new Error("opacity 必须是 0 到 1 之间的数字。");
        }
        node.opacity = Number(payload.opacity);
      }
      return successResult(
        command.capabilityId,
        `已创建 SVG 节点 "${node.name}"。`,
        { changedNodeIds: [node.id] },
      );
    }

    case "text.set-content": {
      const payload = command.payload as { value: string };
      if (!String(payload.value || "").length) {
        throw new Error("文本内容不能为空。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (await setTextContent(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改文字内容的文本节点。");
      }

      return successResult(command.capabilityId, `已更新 ${changedNodeIds.length} 个文本节点的内容。`, {
        changedNodeIds,
        warnings,
      });
    }

    case "text.set-font-size": {
      const payload = command.payload as { value: number };
      if (!Number.isFinite(payload.value) || payload.value <= 0) {
        throw new Error("字号必须是大于 0 的数字。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (await setTextFontSize(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改字号的文本节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点的字号设为 ${payload.value}px。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "text.set-font-family": {
      const payload = command.payload as { family: string; style?: string };
      if (!String(payload.family || "").trim()) {
        throw new Error("字体族不能为空。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (await setTextFontFamily(node, payload.family.trim(), payload.style?.trim())) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改字体族的文本节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点的字体改为 ${payload.family.trim()}。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "text.set-font-weight": {
      const payload = command.payload as { value: number | string };
      if (payload.value === undefined || payload.value === null || `${payload.value}`.trim() === "") {
        throw new Error("字重不能为空。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (await setTextFontWeight(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改字重的文本节点。");
      }

      return successResult(
        command.capabilityId,
        `已更新 ${changedNodeIds.length} 个文本节点的字重。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "text.set-text-color": {
      const payload = command.payload as { hex: string };
      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (setTextColor(node, payload.hex)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可改文字颜色的文本节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点的颜色改为 ${normalizeHex(payload.hex)}。`,
        {
          changedNodeIds,
        },
      );
    }

    case "text.set-line-height": {
      const payload = command.payload as { value: number };
      if (!Number.isFinite(payload.value) || payload.value <= 0) {
        throw new Error("行高必须是大于 0 的数字。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (await setTextLineHeight(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改行高的文本节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点的行高设为 ${payload.value}px。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "text.set-letter-spacing": {
      const payload = command.payload as { value: number };
      if (!Number.isFinite(payload.value)) {
        throw new Error("字距必须是有效数字。");
      }

      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (await setTextLetterSpacing(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改字距的文本节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点的字距设为 ${payload.value}px。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "text.set-alignment": {
      const payload = command.payload as { value: "left" | "center" | "right" | "justified" };
      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (setTextAlignment(node, payload.value)) {
            changedNodeIds.push(node.id);
          }
        } catch (error) {
          warnings.push(`${node.name || node.id}: ${error instanceof Error ? error.message : "未知错误"}`);
        }
      }

      if (!changedNodeIds.length) {
        throw new Error(warnings[0] || "当前 selection 中没有可改对齐的文本节点。");
      }

      return successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个文本节点设为 ${payload.value} 对齐。`,
        {
          changedNodeIds,
          warnings,
        },
      );
    }

    case "styles.upsert-text-style": {
      const payload = command.payload as {
        name: string;
        fontFamily: string;
        fontStyle?: string;
        fontSize: number;
        textColorHex?: string;
      };
      if (!String(payload.name || "").trim()) {
        throw new Error("text style 名称不能为空。");
      }
      if (!String(payload.fontFamily || "").trim()) {
        throw new Error("text style 字体族不能为空。");
      }
      if (!Number.isFinite(payload.fontSize) || payload.fontSize <= 0) {
        throw new Error("text style 字号必须是大于 0 的数字。");
      }

      const result = await upsertTextStyle(
        payload.name.trim(),
        payload.fontFamily.trim(),
        payload.fontSize,
        payload.fontStyle?.trim(),
        payload.textColorHex,
      );

      return successResult(command.capabilityId, `已更新本地文字样式 ${result.style.name}。`, {
        createdStyleIds: [result.style.id],
      });
    }

    case "styles.apply-style": {
      const payload = command.payload as {
        styleType: "paint" | "text";
        styleName: string;
      };
      if (!String(payload.styleName || "").trim()) {
        throw new Error("要应用的样式名称不能为空。");
      }

      const changedNodeIds: string[] = [];
      if (payload.styleType === "paint") {
        const localStyles = await figma.getLocalPaintStylesAsync();
        const style = localStyles.find((item: any) => item.name === payload.styleName);
        if (!style) {
          throw new Error(`未找到本地 paint style: ${payload.styleName}`);
        }

        for (const node of await getTargetNodes(command, batchSource)) {
          try {
            if (applyPaintStyleToNode(node, style.id)) {
              changedNodeIds.push(node.id);
            }
          } catch {
            // Ignore non-editable overrides.
          }
        }
      } else {
        const localStyles = await figma.getLocalTextStylesAsync();
        const style = localStyles.find((item: any) => item.name === payload.styleName);
        if (!style) {
          throw new Error(`未找到本地 text style: ${payload.styleName}`);
        }

        for (const node of await getTargetNodes(command, batchSource)) {
          try {
            if (applyTextStyleToNode(node, style.id)) {
              changedNodeIds.push(node.id);
            }
          } catch {
            // Ignore non-editable overrides.
          }
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可应用该样式的节点。");
      }

      return successResult(
        command.capabilityId,
        `已将样式 ${payload.styleName} 应用到 ${changedNodeIds.length} 个节点。`,
        {
          changedNodeIds,
        },
      );
    }

    case "styles.detach-style": {
      const payload = command.payload as {
        styleType: "fill" | "stroke" | "text";
      };
      const changedNodeIds: string[] = [];
      for (const node of await getTargetNodes(command, batchSource)) {
        try {
          if (detachStyleFromNode(node, payload.styleType)) {
            changedNodeIds.push(node.id);
          }
        } catch {
          // Ignore non-editable overrides.
        }
      }

      if (!changedNodeIds.length) {
        throw new Error("当前 selection 中没有可解绑该样式的节点。");
      }

      return successResult(
        command.capabilityId,
        `已从 ${changedNodeIds.length} 个节点解绑 ${payload.styleType} style。`,
        {
          changedNodeIds,
        },
      );
    }

    case "styles.upsert-paint-style": {
      const payload = command.payload as {
        name: string;
        hex: string;
        applyToSelection?: boolean;
      };
      const result = await upsertPaintStyle(
        payload.name,
        payload.hex,
        Boolean(payload.applyToSelection),
      );

      return successResult(
        command.capabilityId,
        payload.applyToSelection
          ? `已更新本地样式 ${result.style.name}，并应用到 ${result.changedNodeIds.length} 个节点。`
          : `已更新本地样式 ${result.style.name}。`,
        {
          changedNodeIds: result.changedNodeIds,
          createdStyleIds: [result.style.id],
          warnings: result.warnings,
        },
      );
    }

    case "variables.upsert-color-variable": {
      const payload = command.payload as {
        collectionName: string;
        variableName: string;
        hex: string;
        bindToSelection?: boolean;
      };
      const result = await upsertColorVariable(
        payload.collectionName,
        payload.variableName,
        payload.hex,
        Boolean(payload.bindToSelection),
      );

      return successResult(
        command.capabilityId,
        payload.bindToSelection
          ? `已更新变量 ${result.collection.name}/${result.variable.name}，并绑定到 ${result.changedNodeIds.length} 个节点。`
          : `已更新变量 ${result.collection.name}/${result.variable.name}。`,
        {
          changedNodeIds: result.changedNodeIds,
          createdVariableIds: [result.variable.id],
          warnings: result.warnings,
        },
      );
    }

    case "undo.undo-last": {
      if (undoStack.length === 0) {
        throw new Error("撤销栈为空，没有可撤销的操作。");
      }

      const entry = undoStack.pop()!;
      const restoredNodeIds: string[] = [];
      const warnings: string[] = [];

      // Restore property snapshots
      for (const snapshot of entry.snapshots) {
        try {
          const node = await figma.getNodeByIdAsync(snapshot.nodeId) as any;
          if (!node) {
            warnings.push(`节点 ${snapshot.nodeId} 已不存在，跳过恢复。`);
            continue;
          }

          // Load fonts before restoring text properties
          if (supportsText(node) && (
            "fontName" in snapshot.properties ||
            "characters" in snapshot.properties ||
            "fontSize" in snapshot.properties
          )) {
            await loadNodeFonts(node);
            if (snapshot.properties.fontName) {
              await figma.loadFontAsync(snapshot.properties.fontName);
            }
          }

          for (const [key, value] of Object.entries(snapshot.properties)) {
            if (key === "width" || key === "height") continue;
            // Style ID properties require async setters in dynamic-page mode
            if (key === "fillStyleId" && "setFillStyleIdAsync" in node) {
              await node.setFillStyleIdAsync(value || "");
            } else if (key === "strokeStyleId" && "setStrokeStyleIdAsync" in node) {
              await node.setStrokeStyleIdAsync(value || "");
            } else if (key === "textStyleId" && "setTextStyleIdAsync" in node) {
              await node.setTextStyleIdAsync(value || "");
            } else {
              node[key] = value;
            }
          }

          // Handle resize specially
          if ("width" in snapshot.properties && "height" in snapshot.properties) {
            if (supportsResize(node)) {
              node.resize(snapshot.properties.width, snapshot.properties.height);
            }
          }

          restoredNodeIds.push(snapshot.nodeId);
        } catch (error) {
          warnings.push(
            `恢复节点 ${snapshot.nodeId} 失败: ${error instanceof Error ? error.message : "未知错误"}`,
          );
        }
      }

      // Delete created nodes
      for (const nodeId of entry.createdNodeIds) {
        try {
          const node = await figma.getNodeByIdAsync(nodeId);
          if (node && node.parent) {
            node.remove();
            restoredNodeIds.push(nodeId);
          }
        } catch (error) {
          warnings.push(
            `删除节点 ${nodeId} 失败: ${error instanceof Error ? error.message : "未知错误"}`,
          );
        }
      }

      return successResult(
        command.capabilityId,
        `已撤销 ${entry.capabilityId}，恢复了 ${restoredNodeIds.length} 个节点。`,
        { changedNodeIds: restoredNodeIds, warnings },
      );
    }

    default:
      throw new Error(`不支持的能力命令: ${String((command as { capabilityId: string }).capabilityId)}`);
  }
}

export function getRuntimeCapabilities(): PluginCapabilityDescriptor[] {
  return IMPLEMENTED_PLUGIN_CAPABILITIES;
}

export function getRuntimeFeatures(): PluginRuntimeFeatures {
  return {
    supportsExplicitNodeTargeting: true,
  };
}

export async function runPluginCommandBatch(batch: FigmaPluginCommandBatch): Promise<BatchRunResult> {
  if (!Array.isArray(batch.commands) || batch.commands.length === 0) {
    throw new Error("命令数组为空，无法执行。");
  }

  const results: PluginCommandExecutionResult[] = [];

  for (const rawCommand of batch.commands) {
    const command = normalizeLegacyCommand(rawCommand);

    try {
      const result = await runCapabilityCommand(command, batch.source);
      results.push(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      const failure = failureResult(command.capabilityId, message);
      results.push(failure);

      if (command.executionMode !== "best-effort") {
        break;
      }
    }
  }

  const ok = results.every((item) => item.ok);
  const message = results.length
    ? results[results.length - 1].message
    : "没有执行任何插件命令。";

  return {
    ok,
    results,
    message,
  };
}
