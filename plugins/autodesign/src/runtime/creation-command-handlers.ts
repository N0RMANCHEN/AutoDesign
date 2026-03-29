import type { PluginCommandExecutionResult } from "../../../../shared/plugin-bridge.js";
import type { FigmaCapabilityCommand } from "../../../../shared/plugin-contract.js";

import { createSolidPaint } from "./selection-context.js";
import {
  applyFillStrokeOpacity,
  parentUsesAutoLayout,
  supportsChildren,
  supportsPosition,
} from "./node-style-helpers.js";
import { normalizeFontWeightStyle, normalizeTextAlignment } from "./text-style-helpers.js";
import { decodeDataUrl } from "./asset-reconstruction-command-handlers.js";

type SuccessResultFactory = (
  capabilityId: FigmaCapabilityCommand["capabilityId"],
  message: string,
  details?: Partial<Omit<PluginCommandExecutionResult, "capabilityId" | "ok" | "message">>,
) => PluginCommandExecutionResult;

type CreationCommandDeps = {
  getTargetNodes: (command: FigmaCapabilityCommand, batchSource?: string) => Promise<any[]>;
  resolveBatchNodeId: (nodeId: string) => string;
  registerAnalysisRefId: (analysisRefId: string | undefined, nodeId: string) => void;
  persistAnalysisRefId: (node: any, analysisRefId: string | undefined) => void;
  successResult: SuccessResultFactory;
};

export const CREATION_CAPABILITIES = new Set<string>([
  "nodes.create-frame",
  "nodes.create-text",
  "nodes.create-image",
  "nodes.create-rectangle",
  "nodes.create-ellipse",
  "nodes.create-line",
  "nodes.create-svg",
  "components.create-instance",
  "nodes.duplicate",
  "nodes.group",
  "nodes.frame-selection",
]);

export function hasExplicitCreationParent(command: FigmaCapabilityCommand) {
  if (!CREATION_CAPABILITIES.has(command.capabilityId)) {
    return false;
  }
  const payload =
    command.payload && typeof command.payload === "object"
      ? (command.payload as { parentNodeId?: unknown })
      : null;
  return typeof payload?.parentNodeId === "string" && payload.parentNodeId.trim().length > 0;
}

export function resolveTextBoxMode(params: {
  width?: number;
  height?: number;
  textAutoResize?: "WIDTH_AND_HEIGHT" | "HEIGHT" | "NONE";
}) {
  const hasWidth = Number.isFinite(params.width) && Number(params.width) > 0;
  const hasHeight = Number.isFinite(params.height) && Number(params.height) > 0;
  if (params.textAutoResize) {
    return params.textAutoResize;
  }
  if (hasWidth && hasHeight) {
    return "NONE" as const;
  }
  if (hasWidth) {
    return "HEIGHT" as const;
  }
  return null;
}

export function normalizeImageFitMode(value: unknown) {
  return value === "contain" || value === "stretch" ? value : "cover";
}

export function resolveImagePaintScaleMode(value: unknown) {
  return normalizeImageFitMode(value) === "contain" ? "FIT" : "FILL";
}

const GENERIC_FONT_FAMILIES = new Set([
  "cursive",
  "emoji",
  "fangsong",
  "fantasy",
  "math",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);

function pushUnique(values: string[], seen: Set<string>, value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return;
  }
  const key = normalized.toLowerCase();
  if (seen.has(key)) {
    return;
  }
  values.push(normalized);
  seen.add(key);
}

export function resolveFontFamilyCandidates(primaryFamily?: string, fallbackFamilies?: string[]) {
  const families: string[] = [];
  const seen = new Set<string>();
  for (const family of [primaryFamily, ...(fallbackFamilies || [])]) {
    const normalized = String(family || "").trim();
    if (!normalized || GENERIC_FONT_FAMILIES.has(normalized.toLowerCase())) {
      continue;
    }
    pushUnique(families, seen, normalized);
  }
  if (!families.length) {
    families.push("Inter");
  }
  return families;
}

function fontWeightStyleCandidates(value: number | string | undefined) {
  if (value === undefined || value === null) {
    return ["Regular", "Roman"];
  }
  const normalizedWeight =
    typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : null;
  if (normalizedWeight !== null) {
    if (normalizedWeight >= 800) {
      return ["Extra Bold", "ExtraBold", "Bold"];
    }
    if (normalizedWeight >= 700) {
      return ["Bold", "Semibold", "Semi Bold", "Regular"];
    }
    if (normalizedWeight >= 600) {
      return ["Semibold", "Semi Bold", "Bold", "Regular"];
    }
    if (normalizedWeight >= 500) {
      return ["Medium", "Regular", "Roman"];
    }
    if (normalizedWeight >= 400) {
      return ["Regular", "Roman", "Book"];
    }
    return ["Light", "Regular", "Roman"];
  }

  try {
    const normalizedStyle = String(normalizeFontWeightStyle(value));
    if (/semi\s*bold/i.test(normalizedStyle)) {
      return ["Semibold", "Semi Bold", "Bold", "Regular"];
    }
    if (/extra\s*bold/i.test(normalizedStyle)) {
      return ["Extra Bold", "ExtraBold", "Bold"];
    }
    if (/bold/i.test(normalizedStyle)) {
      return ["Bold", "Semibold", "Semi Bold", "Regular"];
    }
    if (/medium/i.test(normalizedStyle)) {
      return ["Medium", "Regular", "Roman"];
    }
    if (/light/i.test(normalizedStyle)) {
      return ["Light", "Regular", "Roman"];
    }
  } catch {
    // fall through to raw style aliases below
  }

  return ["Regular", "Roman", "Book"];
}

function fontStyleAliases(value: string | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return [];
  }
  if (/semi\s*bold/i.test(normalized)) {
    return ["Semibold", "Semi Bold", "Bold", "Regular"];
  }
  if (/extra\s*bold/i.test(normalized)) {
    return ["Extra Bold", "ExtraBold", "Bold"];
  }
  if (/bold/i.test(normalized)) {
    return ["Bold", "Semibold", "Semi Bold", "Regular"];
  }
  if (/medium/i.test(normalized)) {
    return ["Medium", "Regular", "Roman"];
  }
  if (/regular|normal/i.test(normalized)) {
    return ["Regular", "Roman", "Book"];
  }
  if (/roman/i.test(normalized)) {
    return ["Roman", "Regular", "Book"];
  }
  if (/light/i.test(normalized)) {
    return ["Light", "Regular", "Roman"];
  }
  return [normalized];
}

function normalizeComparableFontStyle(value: string | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "");
}

function normalizeComparableFontFamily(value: string | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "");
}

function normalizeStrictFontStyleKey(value: string | undefined) {
  const normalized = normalizeComparableFontStyle(value);
  if (!normalized || normalized === "regular" || normalized === "roman" || normalized === "normal" || normalized === "book") {
    return "regular";
  }
  if (normalized === "semibold" || normalized === "semibd") {
    return "semibold";
  }
  if (normalized === "bold") {
    return "bold";
  }
  if (normalized === "medium") {
    return "medium";
  }
  if (normalized === "light") {
    return "light";
  }
  return normalized;
}

function buildAvailableFontCatalog(fonts: Array<{ fontName?: { family?: string; style?: string } | null }>) {
  const seen = new Set<string>();
  const catalog: Array<{ family: string; style: string; familyKey: string; strictStyleKey: string }> = [];
  for (const font of fonts) {
    const family = String(font.fontName?.family || "").trim();
    const style = String(font.fontName?.style || "").trim();
    if (!family || !style) {
      continue;
    }
    const familyKey = normalizeComparableFontFamily(family);
    const strictStyleKey = normalizeStrictFontStyleKey(style);
    const key = `${familyKey}::${strictStyleKey}::${normalizeComparableFontStyle(style)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    catalog.push({
      family,
      style,
      familyKey,
      strictStyleKey,
    });
  }
  return catalog;
}

async function tryLoadExactFont(
  family: string | null,
  style: string | null,
) {
  const normalizedFamily = String(family || "").trim();
  if (!normalizedFamily) {
    return null;
  }
  const normalizedStyle = String(style || "").trim() || "Regular";
  const targetFont = {
    family: normalizedFamily,
    style: normalizedStyle,
  };
  try {
    await figma.loadFontAsync(targetFont);
    return targetFont;
  } catch {
    return null;
  }
}

export function resolveFontStyleCandidates(fontStyle?: string, fontWeight?: number | string) {
  const styles: string[] = [];
  const seen = new Set<string>();
  for (const style of [...fontStyleAliases(fontStyle), ...fontWeightStyleCandidates(fontWeight), "Regular", "Roman"]) {
    pushUnique(styles, seen, style);
  }
  return styles;
}

async function resolveTextFont(params: {
  fontFamily?: string;
  fontFamilyCandidates?: string[];
  fontStyle?: string;
  fontWeight?: number | string;
  resolvedBrowserFontFamily?: string;
  resolvedBrowserFontStyle?: string;
}) {
  const browserResolvedFamily = String(params.resolvedBrowserFontFamily || "").trim() || null;
  const browserResolvedStyle = String(params.resolvedBrowserFontStyle || "").trim() || null;
  const requestedFamilyCandidates = resolveFontFamilyCandidates(params.fontFamily, params.fontFamilyCandidates);
  const familyCandidates = browserResolvedFamily
    ? resolveFontFamilyCandidates(browserResolvedFamily, requestedFamilyCandidates)
    : requestedFamilyCandidates;
  const styleCandidates = browserResolvedStyle
    ? resolveFontStyleCandidates(browserResolvedStyle, undefined)
    : resolveFontStyleCandidates(params.fontStyle, params.fontWeight);
  const attempted: string[] = [];
  const availableFonts = buildAvailableFontCatalog(await figma.listAvailableFontsAsync());
  const browserFamilyKey = normalizeComparableFontFamily(browserResolvedFamily || undefined);
  const browserStyleKey = normalizeStrictFontStyleKey(browserResolvedStyle || undefined);

  if (browserResolvedFamily) {
    const exactMatch = availableFonts.find(
      (font) => font.familyKey === browserFamilyKey && font.strictStyleKey === browserStyleKey,
    );
    if (exactMatch) {
      const targetFont = { family: exactMatch.family, style: exactMatch.style };
      attempted.push(`${targetFont.family}/${targetFont.style}`);
      await figma.loadFontAsync(targetFont);
      return {
        targetFont,
        requestedFamilies: familyCandidates,
        requestedStyles: styleCandidates,
        browserResolvedFamily,
        browserResolvedStyle,
        fallbackOccurred: false,
        deviatesFromBrowser: false,
      };
    }

    const directlyLoadedFont = await tryLoadExactFont(browserResolvedFamily, browserResolvedStyle);
    if (directlyLoadedFont) {
      attempted.push(`${directlyLoadedFont.family}/${directlyLoadedFont.style}`);
      return {
        targetFont: directlyLoadedFont,
        requestedFamilies: familyCandidates,
        requestedStyles: styleCandidates,
        browserResolvedFamily,
        browserResolvedStyle,
        fallbackOccurred: false,
        deviatesFromBrowser: false,
      };
    }

    throw new Error(
      `当前 Figma session 未暴露浏览器实际字体 ${browserResolvedFamily}/${browserResolvedStyle || "Regular"}。`,
    );
  }

  for (const family of familyCandidates) {
    for (const style of styleCandidates) {
      const catalogMatch = availableFonts.find(
        (font) =>
          font.familyKey === normalizeComparableFontFamily(family) &&
          font.strictStyleKey === normalizeStrictFontStyleKey(style),
      );
      if (!catalogMatch) {
        attempted.push(`${family}/${style}`);
        const directlyLoadedFont = await tryLoadExactFont(family, style);
        if (!directlyLoadedFont) {
          continue;
        }
        return {
          targetFont: directlyLoadedFont,
          requestedFamilies: familyCandidates,
          requestedStyles: styleCandidates,
          browserResolvedFamily,
          browserResolvedStyle,
          fallbackOccurred: family !== familyCandidates[0] || style !== styleCandidates[0],
          deviatesFromBrowser:
            browserResolvedFamily === null
              ? null
              : normalizeComparableFontFamily(directlyLoadedFont.family) !== browserFamilyKey ||
                (browserResolvedStyle !== null &&
                  normalizeStrictFontStyleKey(directlyLoadedFont.style) !== normalizeStrictFontStyleKey(browserResolvedStyle)),
        };
      }
      const targetFont = { family: catalogMatch.family, style: catalogMatch.style };
      attempted.push(`${targetFont.family}/${targetFont.style}`);
      try {
        await figma.loadFontAsync(targetFont);
        const fallbackOccurred = family !== familyCandidates[0] || style !== styleCandidates[0];
        const deviatesFromBrowser =
          browserResolvedFamily === null
            ? null
            : normalizeComparableFontFamily(targetFont.family) !== browserFamilyKey ||
              (browserResolvedStyle !== null &&
                normalizeStrictFontStyleKey(targetFont.style) !== normalizeStrictFontStyleKey(browserResolvedStyle));
        return {
          targetFont,
          requestedFamilies: familyCandidates,
          requestedStyles: styleCandidates,
          browserResolvedFamily,
          browserResolvedStyle,
          fallbackOccurred,
          deviatesFromBrowser,
        };
      } catch {
        continue;
      }
    }
  }

  throw new Error(`无法在 Figma 中加载文本字体。已尝试：${attempted.join(", ")}`);
}

async function resolveParentNode(parentNodeId: string | undefined, deps: CreationCommandDeps): Promise<any> {
  if (!parentNodeId) {
    return figma.currentPage;
  }

  const resolvedNodeId = deps.resolveBatchNodeId(parentNodeId);
  const node = await figma.getNodeByIdAsync(resolvedNodeId);
  if (!node) {
    throw new Error(`parentNodeId "${parentNodeId}" 在当前文件中未找到。`);
  }

  if (!supportsChildren(node)) {
    throw new Error(`parentNodeId "${parentNodeId}" (${node.type}) 不是容器节点，不支持子节点。`);
  }

  return node;
}

async function resolveComponentNode(componentNodeId: string, deps: CreationCommandDeps): Promise<any> {
  const resolvedNodeId = deps.resolveBatchNodeId(componentNodeId);
  const node = await figma.getNodeByIdAsync(resolvedNodeId);
  if (!node) {
    throw new Error(`mainComponentNodeId "${componentNodeId}" 在当前文件中未找到。`);
  }
  if (node.type !== "COMPONENT") {
    throw new Error(`mainComponentNodeId "${componentNodeId}" 不是 COMPONENT，当前为 ${node.type}。`);
  }
  return node;
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
  if (!supportsPosition(node) || typeof node.width !== "number" || typeof node.height !== "number") {
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

export async function tryRunCreationCapabilityCommand(
  command: FigmaCapabilityCommand,
  batchSource: string | undefined,
  deps: CreationCommandDeps,
): Promise<PluginCommandExecutionResult | null> {
  switch (command.capabilityId) {
    case "components.create-component": {
      const payload = command.payload as { name?: string };
      const targets = await deps.getTargetNodes(command, batchSource);
      if (targets.length !== 1) {
        throw new Error("create-component 需要且仅支持一个目标节点。");
      }
      const component = figma.createComponentFromNode(targets[0]);
      if (payload.name && payload.name.trim()) {
        component.name = payload.name.trim();
      }
      return deps.successResult(command.capabilityId, `已创建组件 "${component.name}"。`, {
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
      const component = await resolveComponentNode(String(payload.mainComponentNodeId), deps);
      const parent = await resolveParentNode(payload.parentNodeId, deps);
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
      return deps.successResult(command.capabilityId, `已创建组件实例 "${instance.name}"。`, {
        changedNodeIds: [instance.id],
      });
    }

    case "components.detach-instance": {
      const changedNodeIds: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        if (node.type !== "INSTANCE" || typeof node.detachInstance !== "function") {
          throw new Error(`${node.name || node.id} 不是可 detach 的实例节点。`);
        }
        const detached = node.detachInstance();
        changedNodeIds.push(detached.id);
      }
      return deps.successResult(command.capabilityId, `已 detach ${changedNodeIds.length} 个实例。`, {
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
        analysisRefId?: string;
      };

      if (
        !Number.isFinite(payload.width) ||
        !Number.isFinite(payload.height) ||
        payload.width <= 0 ||
        payload.height <= 0
      ) {
        throw new Error("Frame 的宽高必须是大于 0 的数字。");
      }

      const parent = await resolveParentNode(payload.parentNodeId, deps);
      const frame = figma.createFrame();
      parent.appendChild(frame);
      frame.resize(payload.width, payload.height);

      if (payload.name && payload.name.trim()) {
        frame.name = payload.name.trim();
      }
      if (Number.isFinite(payload.x)) {
        frame.x = payload.x;
      }
      if (Number.isFinite(payload.y)) {
        frame.y = payload.y;
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

      deps.persistAnalysisRefId(frame, payload.analysisRefId);
      deps.registerAnalysisRefId(payload.analysisRefId, frame.id);

      return deps.successResult(
        command.capabilityId,
        `已创建 Frame "${frame.name}" (${payload.width} × ${payload.height})。`,
        {
          changedNodeIds: [frame.id],
          createdNodeReceipts: [
            {
              nodeId: frame.id,
              nodeType: frame.type,
              name: frame.name,
              analysisRefId: payload.analysisRefId || null,
              parentNodeId: parent.id,
            },
          ],
        },
      );
    }

    case "nodes.create-text": {
      const payload = command.payload as {
        name?: string;
        content: string;
        fontFamily?: string;
        fontFamilyCandidates?: string[];
        fontStyle?: string;
        resolvedBrowserFontFamily?: string;
        resolvedBrowserFontStyle?: string;
        fontSize?: number;
        fontWeight?: number | string;
        colorHex?: string;
        lineHeight?: number;
        letterSpacing?: number;
        alignment?: "left" | "center" | "right" | "justified";
        width?: number;
        height?: number;
        textAutoResize?: "WIDTH_AND_HEIGHT" | "HEIGHT" | "NONE";
        x?: number;
        y?: number;
        parentNodeId?: string;
        analysisRefId?: string;
      };

      if (!String(payload.content || "").length) {
        throw new Error("文本内容不能为空。");
      }

      const targetFont = await resolveTextFont({
        fontFamily: payload.fontFamily?.trim() || "Inter",
        fontFamilyCandidates: payload.fontFamilyCandidates,
        fontStyle: payload.fontStyle?.trim(),
        fontWeight: payload.fontWeight,
        resolvedBrowserFontFamily: payload.resolvedBrowserFontFamily?.trim(),
        resolvedBrowserFontStyle: payload.resolvedBrowserFontStyle?.trim(),
      });

      const parent = await resolveParentNode(payload.parentNodeId, deps);
      const textNode = figma.createText();
      parent.appendChild(textNode);

      if (payload.name && payload.name.trim()) {
        textNode.name = payload.name.trim();
      }
      textNode.fontName = targetFont.targetFont;
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
      const textBoxMode = resolveTextBoxMode(payload);
      const hasWidth = Number.isFinite(payload.width) && Number(payload.width) > 0;
      const hasHeight = Number.isFinite(payload.height) && Number(payload.height) > 0;
      if (textBoxMode === "HEIGHT" && "textAutoResize" in textNode) {
        textNode.textAutoResize = "NONE";
        if (hasWidth) {
          textNode.resize(Number(payload.width), Math.max(1, Number(textNode.height)));
        }
        textNode.textAutoResize = "HEIGHT";
      } else {
        if (textBoxMode && "textAutoResize" in textNode) {
          textNode.textAutoResize = textBoxMode;
        }
        if (hasWidth || hasHeight) {
          const effectiveWidth = hasWidth ? Number(payload.width) : Math.max(1, Number(textNode.width));
          const effectiveHeight = hasHeight ? Number(payload.height) : Math.max(1, Number(textNode.height));
          textNode.resize(effectiveWidth, effectiveHeight);
        }
      }
      if (Number.isFinite(payload.x)) {
        textNode.x = payload.x;
      }
      if (Number.isFinite(payload.y)) {
        textNode.y = payload.y;
      }

      const preview = payload.content.length > 30 ? `${payload.content.substring(0, 30)}…` : payload.content;

      deps.persistAnalysisRefId(textNode, payload.analysisRefId);
      deps.registerAnalysisRefId(payload.analysisRefId, textNode.id);

      return deps.successResult(
        command.capabilityId,
        `已创建文本节点 "${textNode.name}" 内容为 "${preview}"。`,
        {
          changedNodeIds: [textNode.id],
          createdNodeReceipts: [
            {
              nodeId: textNode.id,
              nodeType: textNode.type,
              name: textNode.name,
              analysisRefId: payload.analysisRefId || null,
              parentNodeId: parent.id,
              fontResolution: {
                requestedFamilies: targetFont.requestedFamilies,
                requestedStyles: targetFont.requestedStyles,
                browserResolvedFamily: targetFont.browserResolvedFamily,
                browserResolvedStyle: targetFont.browserResolvedStyle,
                figmaResolvedFamily: targetFont.targetFont.family,
                figmaResolvedStyle: targetFont.targetFont.style,
                fallbackOccurred: targetFont.fallbackOccurred,
                deviatesFromBrowser: targetFont.deviatesFromBrowser,
              },
            },
          ],
        },
      );
    }

    case "nodes.create-image": {
      const payload = command.payload as {
        name?: string;
        imageDataUrl: string;
        width: number;
        height: number;
        fitMode?: "cover" | "contain" | "stretch";
        x?: number;
        y?: number;
        opacity?: number;
        cornerRadius?: number;
        parentNodeId?: string;
        analysisRefId?: string;
      };

      if (!String(payload.imageDataUrl || "").trim()) {
        throw new Error("imageDataUrl 不能为空。");
      }
      if (!Number.isFinite(payload.width) || payload.width <= 0 || !Number.isFinite(payload.height) || payload.height <= 0) {
        throw new Error("Image 的宽高必须是大于 0 的数字。");
      }

      const parent = await resolveParentNode(payload.parentNodeId, deps);
      const imageBytes = decodeDataUrl(payload.imageDataUrl).bytes;
      const image = figma.createImage(imageBytes);
      const node = figma.createRectangle();
      parent.appendChild(node);
      if (parentUsesAutoLayout(parent)) {
        if (!("layoutPositioning" in node)) {
          throw new Error("目标父级启用了 Auto Layout，但新图片节点不支持 absolute positioning。");
        }
        node.layoutPositioning = "ABSOLUTE";
      }
      node.resize(Math.max(1, Number(payload.width)), Math.max(1, Number(payload.height)));
      if (payload.name && payload.name.trim()) {
        node.name = payload.name.trim();
      }
      if (Number.isFinite(payload.x)) {
        node.x = Number(payload.x);
      }
      if (Number.isFinite(payload.y)) {
        node.y = Number(payload.y);
      }
      if (payload.cornerRadius !== undefined) {
        if (!Number.isFinite(payload.cornerRadius) || payload.cornerRadius < 0) {
          throw new Error("cornerRadius 必须是大于等于 0 的数字。");
        }
        node.cornerRadius = Number(payload.cornerRadius);
      }

      node.fills = [
        {
          type: "IMAGE",
          imageHash: image.hash,
          scaleMode: resolveImagePaintScaleMode(payload.fitMode),
          visible: true,
          opacity:
            Number.isFinite(payload.opacity) && Number(payload.opacity) >= 0 && Number(payload.opacity) <= 1
              ? Number(payload.opacity)
              : 1,
        },
      ];
      if ("strokes" in node) {
        node.strokes = [];
      }

      deps.persistAnalysisRefId(node, payload.analysisRefId);
      deps.registerAnalysisRefId(payload.analysisRefId, node.id);
      return deps.successResult(command.capabilityId, `已创建图片节点 "${node.name}"。`, {
        changedNodeIds: [node.id],
      });
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
        analysisRefId?: string;
      };
      if (!Number.isFinite(payload.width) || payload.width <= 0 || !Number.isFinite(payload.height) || payload.height <= 0) {
        throw new Error("Rectangle 的宽高必须是大于 0 的数字。");
      }

      const anchorNode = payload.placement ? await resolveAnchorNodeForCreation(command) : null;
      const parent = payload.parentNodeId
        ? await resolveParentNode(payload.parentNodeId, deps)
        : anchorNode && anchorNode.parent
          ? anchorNode.parent
          : await resolveParentNode(undefined, deps);
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
        position = toLocalPosition(
          parent,
          computeRelativePlacement(anchorNode, { width: payload.width, height: payload.height }, payload.placement, gap),
        );
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
      deps.persistAnalysisRefId(node, payload.analysisRefId);
      deps.registerAnalysisRefId(payload.analysisRefId, node.id);
      return deps.successResult(command.capabilityId, `已创建矩形节点 "${node.name}"。`, {
        changedNodeIds: [node.id],
      });
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
        analysisRefId?: string;
      };
      if (!Number.isFinite(payload.width) || payload.width <= 0 || !Number.isFinite(payload.height) || payload.height <= 0) {
        throw new Error("Ellipse 的宽高必须是大于 0 的数字。");
      }

      const parent = await resolveParentNode(payload.parentNodeId, deps);
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
      deps.persistAnalysisRefId(node, payload.analysisRefId);
      deps.registerAnalysisRefId(payload.analysisRefId, node.id);
      return deps.successResult(command.capabilityId, `已创建椭圆节点 "${node.name}"。`, {
        changedNodeIds: [node.id],
      });
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
        analysisRefId?: string;
      };
      if (!Number.isFinite(payload.width) || payload.width <= 0) {
        throw new Error("Line 的 width 必须是大于 0 的数字。");
      }

      const parent = await resolveParentNode(payload.parentNodeId, deps);
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
      deps.persistAnalysisRefId(node, payload.analysisRefId);
      deps.registerAnalysisRefId(payload.analysisRefId, node.id);
      return deps.successResult(command.capabilityId, `已创建线段节点 "${node.name}"。`, {
        changedNodeIds: [node.id],
      });
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
        analysisRefId?: string;
      };
      if (!String(payload.svgMarkup || "").trim()) {
        throw new Error("svgMarkup 不能为空。");
      }

      const parent = await resolveParentNode(payload.parentNodeId, deps);
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
      deps.persistAnalysisRefId(node, payload.analysisRefId);
      deps.registerAnalysisRefId(payload.analysisRefId, node.id);
      return deps.successResult(command.capabilityId, `已创建 SVG 节点 "${node.name}"。`, {
        changedNodeIds: [node.id],
      });
    }

    case "nodes.group": {
      const payload = command.payload as { name?: string };
      const group = groupNodes(await deps.getTargetNodes(command, batchSource), payload.name);

      return deps.successResult(command.capabilityId, `已将当前 selection 分组为 ${group.name}。`, {
        changedNodeIds: [group.id],
      });
    }

    case "nodes.frame-selection": {
      const payload = command.payload as { name?: string; padding?: number };
      if (payload.padding !== undefined && (!Number.isFinite(payload.padding) || payload.padding < 0)) {
        throw new Error("Frame padding 必须是大于等于 0 的数字。");
      }

      const frame = frameNodes(await deps.getTargetNodes(command, batchSource), payload);

      return deps.successResult(
        command.capabilityId,
        `已使用 Frame 包裹当前 selection${payload.name ? `，名称为 ${frame.name}` : ""}。`,
        {
          changedNodeIds: [frame.id],
        },
      );
    }

    default:
      return null;
  }
}
