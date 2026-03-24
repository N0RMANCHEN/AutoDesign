import {
  clonePaints,
  createSolidPaint,
  getBoundFillVariableIds,
  getSelection,
  normalizeHex,
  supportsFills,
  supportsStrokes,
} from "./selection-context.js";

export function supportsText(node: any) {
  return node.type === "TEXT" && "characters" in node;
}

export function getPrimaryFontName(node: any) {
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

export async function loadNodeFonts(node: any) {
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

export function normalizeFontWeightStyle(value: number | string) {
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

export async function setTextContent(node: any, value: string) {
  if (!supportsText(node)) {
    return false;
  }

  await loadNodeFonts(node);
  node.characters = value;
  return true;
}

export async function setTextFontSize(node: any, value: number) {
  if (!supportsText(node)) {
    return false;
  }

  await loadNodeFonts(node);
  node.fontSize = value;
  return true;
}

export async function setTextFontFamily(node: any, family: string, style?: string) {
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

export async function setTextFontWeight(node: any, value: number | string) {
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

export function setTextColor(node: any, hex: string) {
  if (!supportsText(node)) {
    return false;
  }

  node.fills = [createSolidPaint(hex)];
  node.fillStyleId = "";
  return true;
}

export async function setTextLineHeight(node: any, value: number) {
  if (!supportsText(node)) {
    return false;
  }

  await loadNodeFonts(node);
  node.lineHeight = { value, unit: "PIXELS" };
  return true;
}

export async function setTextLetterSpacing(node: any, value: number) {
  if (!supportsText(node)) {
    return false;
  }

  await loadNodeFonts(node);
  node.letterSpacing = { value, unit: "PIXELS" };
  return true;
}

export function normalizeTextAlignment(value: string) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "left" || normalized === "左对齐") return "LEFT";
  if (normalized === "center" || normalized === "居中" || normalized === "居中对齐") return "CENTER";
  if (normalized === "right" || normalized === "右对齐") return "RIGHT";
  if (normalized === "justified" || normalized === "两端对齐") return "JUSTIFIED";
  throw new Error(`不支持的文本对齐值: ${value}`);
}

export function setTextAlignment(node: any, value: string) {
  if (!supportsText(node)) {
    return false;
  }

  node.textAlignHorizontal = normalizeTextAlignment(value);
  return true;
}

export async function upsertPaintStyle(name: string, hex: string, applyToSelection?: boolean) {
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

export async function upsertTextStyle(
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

export function applyPaintStyleToNode(node: any, styleId: string) {
  if (!supportsFills(node)) {
    return false;
  }

  node.fillStyleId = styleId;
  return true;
}

export function applyTextStyleToNode(node: any, styleId: string) {
  if (!supportsText(node)) {
    return false;
  }

  node.textStyleId = styleId;
  return true;
}

export function detachStyleFromNode(node: any, styleType: "fill" | "stroke" | "text") {
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

export async function upsertColorVariable(
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
