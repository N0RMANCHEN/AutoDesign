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
        { changedNodeIds: [frame.id] },
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

      const parent = await resolveParentNode(payload.parentNodeId, deps);
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
        { changedNodeIds: [textNode.id] },
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
