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
  getSelection,
} from "./selection-context.js";
import {
  createBatchExecutionContext,
  type BatchExecutionContext,
  persistAnalysisRefId,
  registerAnalysisRefId,
  resolveBatchNodeId,
} from "./analysis-ref-registry.js";
import { tryRunAssetReconstructionCommand } from "./asset-reconstruction-command-handlers.js";
import {
  CREATION_CAPABILITIES,
  hasExplicitCreationParent,
  tryRunCreationCapabilityCommand,
} from "./creation-command-handlers.js";
import { tryRunNodeCommand } from "./node-command-handlers.js";
import { supportsResize } from "./node-style-helpers.js";
import {
  loadNodeFonts,
  supportsText,
} from "./text-style-helpers.js";
import { tryRunTextStyleCommand } from "./text-style-command-handlers.js";

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
      if ("layoutWrap" in node) props.layoutWrap = node.layoutWrap;
      if ("primaryAxisSizingMode" in node) props.primaryAxisSizingMode = node.primaryAxisSizingMode;
      if ("counterAxisSizingMode" in node) props.counterAxisSizingMode = node.counterAxisSizingMode;
      if ("primaryAxisAlignItems" in node) props.primaryAxisAlignItems = node.primaryAxisAlignItems;
      if ("counterAxisAlignItems" in node) props.counterAxisAlignItems = node.counterAxisAlignItems;
      if ("itemSpacing" in node) props.itemSpacing = node.itemSpacing;
      if ("counterAxisSpacing" in node) props.counterAxisSpacing = node.counterAxisSpacing;
      if ("paddingLeft" in node) props.paddingLeft = node.paddingLeft;
      if ("paddingRight" in node) props.paddingRight = node.paddingRight;
      if ("paddingTop" in node) props.paddingTop = node.paddingTop;
      if ("paddingBottom" in node) props.paddingBottom = node.paddingBottom;
      if ("clipsContent" in node) props.clipsContent = node.clipsContent;
      if ("minWidth" in node) props.minWidth = node.minWidth;
      if ("maxWidth" in node) props.maxWidth = node.maxWidth;
      if ("minHeight" in node) props.minHeight = node.minHeight;
      if ("maxHeight" in node) props.maxHeight = node.maxHeight;
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

let activeBatchContext: BatchExecutionContext | null = null;

async function getTargetNodes(
  command: FigmaCapabilityCommand,
  batchSource?: string,
): Promise<ReturnType<typeof getSelection>> {
  if (!command.nodeIds || command.nodeIds.length === 0) {
    const selection = getSelection();
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
  const resolvedNodeIds = command.nodeIds.map((nodeId) => resolveBatchNodeId(activeBatchContext, nodeId));
  const idSet = new Set(resolvedNodeIds);
  const selection = figma.currentPage.selection;
  const filtered = selection.filter((node: (typeof selection)[number]) => idSet.has(node.id));
  if (filtered.length) {
    return filtered;
  }

  if (batchSource === "codex") {
    const resolved = (
      await Promise.all(
        resolvedNodeIds.map(async (nodeId) => {
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
  const assetResult = await tryRunAssetReconstructionCommand(command, batchSource, {
    getTargetNodes,
    successResult,
  });
  if (assetResult) {
    return assetResult;
  }

  const creationResult = await tryRunCreationCapabilityCommand(command, batchSource, {
    getTargetNodes,
    resolveBatchNodeId: (nodeId) => resolveBatchNodeId(activeBatchContext, nodeId),
    registerAnalysisRefId: (analysisRefId, nodeId) =>
      registerAnalysisRefId(activeBatchContext, analysisRefId, nodeId),
    persistAnalysisRefId,
    successResult,
  });
  if (creationResult) {
    return creationResult;
  }

  const nodeResult = await tryRunNodeCommand(command, batchSource, {
    getTargetNodes,
    successResult,
  });
  if (nodeResult) {
    return nodeResult;
  }

  const textStyleResult = await tryRunTextStyleCommand(command, batchSource, {
    getTargetNodes,
    successResult,
  });
  if (textStyleResult) {
    return textStyleResult;
  }

  switch (command.capabilityId) {
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

  const previousBatchContext = activeBatchContext;
  activeBatchContext = createBatchExecutionContext();

  const results: PluginCommandExecutionResult[] = [];

  try {
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
  } finally {
    activeBatchContext = previousBatchContext;
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
