import {
  IMPLEMENTED_PLUGIN_CAPABILITIES,
  getPluginCapabilityDescriptor,
  type PluginCapabilityDescriptor,
  type PluginCapabilityId,
} from "../../../../shared/plugin-capabilities.js";
import type {
  PluginCommandExecutionResult,
} from "../../../../shared/plugin-bridge.js";
import type {
  FigmaCapabilityCommand,
  FigmaPluginCommand,
  FigmaPluginCommandBatch,
} from "../../../../shared/plugin-contract.js";
import {
  clonePaints,
  createSolidPaint,
  getBoundFillVariableIds,
  getSelection,
  normalizeHex,
  supportsCornerRadius,
  supportsFills,
  supportsStrokes,
} from "./selection-context.js";

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

function applyFillToNode(node: any, paint: any) {
  if (!supportsFills(node)) {
    return false;
  }

  node.fills = [paint];
  node.fillStyleId = "";
  return true;
}

function applyStrokeToNode(node: any, paint: any) {
  if (!supportsStrokes(node)) {
    return false;
  }

  node.strokes = [paint];
  node.strokeStyleId = "";
  if (!node.strokeWeight || node.strokeWeight <= 0) {
    node.strokeWeight = 1;
  }
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

async function runCapabilityCommand(
  command: FigmaCapabilityCommand,
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

  switch (command.capabilityId) {
    case "selection.refresh":
      return successResult(command.capabilityId, "已刷新当前 selection。");

    case "fills.set-fill": {
      const payload = command.payload as { hex: string };
      const paint = createSolidPaint(payload.hex);
      const changedNodeIds: string[] = [];

      for (const node of getSelection()) {
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

    case "strokes.set-stroke": {
      const payload = command.payload as { hex: string };
      const paint = createSolidPaint(payload.hex);
      const changedNodeIds: string[] = [];

      for (const node of getSelection()) {
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

    case "geometry.set-radius": {
      const payload = command.payload as { value: number };
      const changedNodeIds: string[] = [];
      for (const node of getSelection()) {
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

    case "nodes.set-opacity": {
      const payload = command.payload as { value: number };
      const changedNodeIds: string[] = [];
      for (const node of getSelection()) {
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

    default:
      throw new Error(`不支持的能力命令: ${String((command as { capabilityId: string }).capabilityId)}`);
  }
}

export function getRuntimeCapabilities(): PluginCapabilityDescriptor[] {
  return IMPLEMENTED_PLUGIN_CAPABILITIES;
}

export async function runPluginCommandBatch(batch: FigmaPluginCommandBatch): Promise<BatchRunResult> {
  if (!Array.isArray(batch.commands) || batch.commands.length === 0) {
    throw new Error("命令数组为空，无法执行。");
  }

  const results: PluginCommandExecutionResult[] = [];

  for (const rawCommand of batch.commands) {
    const command = normalizeLegacyCommand(rawCommand);

    try {
      const result = await runCapabilityCommand(command);
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
