import {
  createSolidPaint,
  supportsCornerRadius,
  supportsFills,
  supportsStrokes,
} from "./selection-context.js";

export function applyFillToNode(node: any, paint: any) {
  if (!supportsFills(node)) {
    return false;
  }

  node.fills = [paint];
  try { node.fillStyleId = ""; } catch { /* no style binding to clear */ }
  return true;
}

export function clearFillOnNode(node: any) {
  if (!supportsFills(node)) {
    return false;
  }

  node.fills = [];
  try { node.fillStyleId = ""; } catch { /* no style binding to clear */ }
  return true;
}

export function applyStrokeToNode(node: any, paint: any) {
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

export function clearStrokeOnNode(node: any) {
  if (!supportsStrokes(node)) {
    return false;
  }

  node.strokes = [];
  try { node.strokeStyleId = ""; } catch { /* no style binding to clear */ }
  return true;
}

export function applyStrokeWeightToNode(node: any, value: number) {
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

export function supportsEffects(node: any) {
  return "effects" in node;
}

export function supportsResize(node: any) {
  return "resize" in node && typeof node.resize === "function";
}

export function supportsPosition(node: any) {
  return "x" in node && "y" in node;
}

export function createShadowEffect(payload: {
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

export function setShadowOnNode(
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

export function setLayerBlurOnNode(node: any, radius: number) {
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

export function clearEffectsOnNode(node: any) {
  if (!supportsEffects(node)) {
    return false;
  }

  node.effects = [];
  return true;
}

export function resizeNode(node: any, width: number, height: number) {
  if (!supportsResize(node)) {
    return false;
  }

  node.resize(width, height);
  return true;
}

export function moveNode(node: any, x: number, y: number) {
  if (!supportsPosition(node)) {
    return false;
  }

  node.x = x;
  node.y = y;
  return true;
}

export function supportsNaming(node: any) {
  return "name" in node;
}

export function supportsCloning(node: any) {
  return "clone" in node && typeof node.clone === "function";
}

export function supportsChildren(node: any) {
  return node && "children" in node && Array.isArray(node.children);
}

export function supportsClipsContent(node: any) {
  return node && "clipsContent" in node;
}

export function supportsMasking(node: any) {
  return node && "isMask" in node;
}

export function parentUsesAutoLayout(parent: any) {
  return "layoutMode" in parent && typeof parent.layoutMode === "string" && parent.layoutMode !== "NONE";
}

export function configureFrameLayout(
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

export function configureChildLayout(
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

export function renameNode(node: any, name: string) {
  if (!supportsNaming(node)) {
    return false;
  }

  node.name = name;
  return true;
}

export function duplicateNode(node: any, offsetX: number, offsetY: number) {
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

export function applyFillStrokeOpacity(
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

export function applyRadiusToNode(node: any, value: number) {
  if (!supportsCornerRadius(node)) {
    return false;
  }

  node.cornerRadius = value;
  return true;
}

export function applyOpacityToNode(node: any, value: number) {
  node.opacity = Math.max(0, Math.min(1, value / 100));
  return true;
}
