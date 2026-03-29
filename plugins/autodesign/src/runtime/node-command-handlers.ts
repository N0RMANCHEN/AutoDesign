import type {
  PluginAvailableFont,
  PluginCommandExecutionResult,
  PluginFontLoadProbeResult,
} from "../../../../shared/plugin-bridge.js";
import type { FigmaCapabilityCommand } from "../../../../shared/plugin-contract.js";

import {
  createSolidPaint,
  inspectNodeSubtree,
  normalizeHex,
} from "./selection-context.js";
import {
  applyFillToNode,
  applyOpacityToNode,
  applyRadiusToNode,
  applyStrokeToNode,
  applyStrokeWeightToNode,
  clearEffectsOnNode,
  clearFillOnNode,
  clearStrokeOnNode,
  configureChildLayout,
  configureFrameLayout,
  duplicateNode,
  moveNode,
  renameNode,
  resizeNode,
  setLayerBlurOnNode,
  setShadowOnNode,
  supportsClipsContent,
  supportsMasking,
} from "./node-style-helpers.js";

type SuccessResultFactory = (
  capabilityId: FigmaCapabilityCommand["capabilityId"],
  message: string,
  details?: Partial<Omit<PluginCommandExecutionResult, "capabilityId" | "ok" | "message">>,
) => PluginCommandExecutionResult;

type NodeCommandDeps = {
  getTargetNodes: (command: FigmaCapabilityCommand, batchSource?: string) => Promise<any[]>;
  successResult: SuccessResultFactory;
};

function normalizeFontCatalogKey(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "");
}

function buildFontCatalog(fonts: Array<{ fontName?: { family?: string; style?: string } | null }>) {
  const seen = new Set<string>();
  const catalog: PluginAvailableFont[] = [];
  for (const font of fonts) {
    const family = String(font.fontName?.family || "").trim();
    const style = String(font.fontName?.style || "").trim();
    if (!family || !style) {
      continue;
    }
    const familyKey = normalizeFontCatalogKey(family);
    const styleKey = normalizeFontCatalogKey(style);
    const key = `${familyKey}::${styleKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    catalog.push({
      family,
      style,
      familyKey,
      styleKey,
    });
  }
  return catalog.sort((left, right) =>
    `${left.familyKey}::${left.styleKey}`.localeCompare(`${right.familyKey}::${right.styleKey}`),
  );
}

function buildFontLoadProbeCatalog(fonts: Array<{ family?: string; style?: string }>) {
  const seen = new Set<string>();
  const catalog: Array<{ family: string; style: string; familyKey: string; styleKey: string }> = [];
  for (const font of fonts) {
    const family = String(font.family || "").trim();
    const style = String(font.style || "").trim() || "Regular";
    if (!family) {
      continue;
    }
    const familyKey = normalizeFontCatalogKey(family);
    const styleKey = normalizeFontCatalogKey(style);
    const key = `${familyKey}::${styleKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    catalog.push({
      family,
      style,
      familyKey,
      styleKey,
    });
  }
  return catalog.sort((left, right) =>
    `${left.familyKey}::${left.styleKey}`.localeCompare(`${right.familyKey}::${right.styleKey}`),
  );
}

export async function tryRunNodeCommand(
  command: FigmaCapabilityCommand,
  batchSource: string | undefined,
  deps: NodeCommandDeps,
): Promise<PluginCommandExecutionResult | null> {
  switch (command.capabilityId) {
    case "runtime.inspect-font-catalog": {
      const catalog = buildFontCatalog(await figma.listAvailableFontsAsync());
      return deps.successResult(command.capabilityId, `已读取 ${catalog.length} 个可用字体样式。`, {
        fontCatalog: catalog,
      });
    }

    case "runtime.probe-font-load": {
      const payload = command.payload as {
        fonts?: Array<{
          family?: string;
          style?: string;
        }>;
      };
      const requestedFonts = buildFontLoadProbeCatalog(payload.fonts || []);
      if (!requestedFonts.length) {
        throw new Error("probe-font-load 需要至少一个 family/style。");
      }

      const fontLoadResults: PluginFontLoadProbeResult[] = [];
      for (const font of requestedFonts) {
        try {
          await figma.loadFontAsync({
            family: font.family,
            style: font.style,
          });
          fontLoadResults.push({
            family: font.family,
            style: font.style,
            familyKey: font.familyKey,
            styleKey: font.styleKey,
            ok: true,
            message: "font load succeeded",
          });
        } catch (error) {
          fontLoadResults.push({
            family: font.family,
            style: font.style,
            familyKey: font.familyKey,
            styleKey: font.styleKey,
            ok: false,
            message: error instanceof Error ? error.message : "font load failed",
          });
        }
      }

      const passed = fontLoadResults.filter((result) => result.ok).length;
      return deps.successResult(
        command.capabilityId,
        `已探测 ${fontLoadResults.length} 个字体样式；成功 ${passed} 个，失败 ${fontLoadResults.length - passed} 个。`,
        {
          fontLoadResults,
        },
      );
    }

    case "selection.refresh":
      return deps.successResult(command.capabilityId, "已刷新当前 selection。");

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
      return deps.successResult(command.capabilityId, `已检查节点子树 "${root.name || root.id}"。`, {
        inspectedNodes,
      });
    }

    case "fills.set-fill": {
      const payload = command.payload as { hex: string };
      const paint = createSolidPaint(payload.hex);
      const changedNodeIds: string[] = [];

      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的 fill 改为 ${normalizeHex(payload.hex)}。`,
        {
          changedNodeIds,
        },
      );
    }

    case "fills.clear-fill": {
      const changedNodeIds: string[] = [];

      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(command.capabilityId, `已清空 ${changedNodeIds.length} 个节点的 fill。`, {
        changedNodeIds,
      });
    }

    case "strokes.set-stroke": {
      const payload = command.payload as { hex: string };
      const paint = createSolidPaint(payload.hex);
      const changedNodeIds: string[] = [];

      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的 stroke 改为 ${normalizeHex(payload.hex)}。`,
        {
          changedNodeIds,
        },
      );
    }

    case "strokes.clear-stroke": {
      const changedNodeIds: string[] = [];

      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
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

      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
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
      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
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
      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
        command.capabilityId,
        `已将 ${changedNodeIds.length} 个节点的图层模糊设为 ${payload.radius}px。`,
        {
          changedNodeIds,
        },
      );
    }

    case "effects.clear-effects": {
      const changedNodeIds: string[] = [];

      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(command.capabilityId, `已清空 ${changedNodeIds.length} 个节点的效果。`, {
        changedNodeIds,
      });
    }

    case "geometry.set-radius": {
      const payload = command.payload as { value: number };
      const changedNodeIds: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
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
      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
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
      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
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
      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
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
      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
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
      for (const node of await deps.getTargetNodes(command, batchSource)) {
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

      return deps.successResult(
        command.capabilityId,
        `已复制 ${changedNodeIds.length} 个节点，并偏移 (${offsetX}, ${offsetY})。`,
        {
          changedNodeIds,
        },
      );
    }

    case "layout.configure-frame": {
      const payload = command.payload as {
        layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
        layoutWrap?: "NO_WRAP" | "WRAP";
        primaryAxisSizingMode?: "FIXED" | "AUTO";
        counterAxisSizingMode?: "FIXED" | "AUTO";
        primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
        counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
        itemSpacing?: number;
        counterAxisSpacing?: number;
        paddingLeft?: number;
        paddingRight?: number;
        paddingTop?: number;
        paddingBottom?: number;
        clipsContent?: boolean;
        minWidth?: number;
        maxWidth?: number;
        minHeight?: number;
        maxHeight?: number;
      };
      const changedNodeIds: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        configureFrameLayout(node, payload);
        changedNodeIds.push(node.id);
      }
      return deps.successResult(command.capabilityId, `已配置 ${changedNodeIds.length} 个 Frame 的布局属性。`, {
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
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        configureChildLayout(node, payload);
        changedNodeIds.push(node.id);
      }
      return deps.successResult(command.capabilityId, `已配置 ${changedNodeIds.length} 个子节点的布局属性。`, {
        changedNodeIds,
      });
    }

    case "nodes.delete": {
      const changedNodeIds: string[] = [];
      const warnings: string[] = [];
      const targetIds = command.nodeIds && command.nodeIds.length > 0
        ? command.nodeIds
        : (await deps.getTargetNodes(command, batchSource)).map((node) => node.id);

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

      return deps.successResult(
        command.capabilityId,
        `已删除 ${changedNodeIds.length} 个节点。`,
        { changedNodeIds, warnings },
      );
    }

    case "nodes.set-clips-content": {
      const payload = command.payload as { value: boolean };
      const changedNodeIds: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        if (!supportsClipsContent(node)) {
          throw new Error(`${node.name || node.id} 不支持 clipsContent。`);
        }
        node.clipsContent = Boolean(payload.value);
        changedNodeIds.push(node.id);
      }
      return deps.successResult(command.capabilityId, `已更新 ${changedNodeIds.length} 个节点的 clipsContent。`, {
        changedNodeIds,
      });
    }

    case "nodes.set-mask": {
      const payload = command.payload as { value: boolean };
      const changedNodeIds: string[] = [];
      for (const node of await deps.getTargetNodes(command, batchSource)) {
        if (!supportsMasking(node)) {
          throw new Error(`${node.name || node.id} 不支持 mask。`);
        }
        node.isMask = Boolean(payload.value);
        changedNodeIds.push(node.id);
      }
      return deps.successResult(command.capabilityId, `已更新 ${changedNodeIds.length} 个节点的 mask 状态。`, {
        changedNodeIds,
      });
    }

    default:
      return null;
  }
}
